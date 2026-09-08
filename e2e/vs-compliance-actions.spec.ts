import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { addCalendarDays } from "../src/lib/trains/game-time";
import { lastClosedVsWeek } from "../src/lib/vs-compliance/workflow.shared";

async function fixture(preset = "rank_aware", rank = 3) {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, { tag: `CA${nanoid(6)}`, name: "Native Compliance Actions" });
  const member = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Compliance Member", allianceRank: rank });
  await sql`UPDATE alliance_members SET join_date = '2020-01-01' WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${member.ashedMemberId}`;
  const ending = lastClosedVsWeek();
  const weeks = [addCalendarDays(ending, -14), addCalendarDays(ending, -7), ending];
  await sql`INSERT INTO vs_compliance_policies(id, alliance_id, version, effective_week, enabled, weekly_minimum, preset) VALUES (${nanoid()}, ${alliance.allianceId}, 1, ${weeks[0]}, true, 40000000, ${preset})`;
  for (const week of weeks) await sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version) VALUES (${nanoid()}, ${alliance.allianceId}, ${member.ashedMemberId}, 'Compliance Member', ${week}, 'weekly', 1, 'hq', 1)`;
  async function actor(roleName: "officer" | "owner" | "member" | "data_entry") {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    return { ...session, headers: { Cookie: authCookieHeader(session) } };
  }
  return { sql, alliance, member, ending, weeks, actor, officer: await actor("officer") };
}

test("discipline API denies bootstrap, member, data-entry and foreign officers", async ({ request }) => {
  const f = await fixture();
  expect((await request.get("/api/vs-compliance")).status()).toBe(401);
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect((await request.get("/api/vs-compliance")).status()).toBe(403);
  expect((await request.get("/api/vs-compliance?eventId=private-event")).status()).toBe(403);
  for (const operation of ["complete", "waive"]) expect((await request.post(`/api/vs-compliance/tasks/fake/${operation}`, { data: { requestId: nanoid(), confirmationBasis: "a".repeat(64), reason: "Private reason" } })).status()).toBe(403);
  for (const role of ["member", "data_entry"] as const) {
    const actor = await f.actor(role);
    expect((await request.get("/api/vs-compliance", { headers: actor.headers })).status()).toBe(403);
    expect((await request.get("/api/vs-compliance?eventId=private-event", { headers: actor.headers })).status()).toBe(403);
    for (const operation of ["complete", "waive"]) expect((await request.post(`/api/vs-compliance/tasks/fake/${operation}`, { headers: actor.headers, data: { requestId: nanoid(), confirmationBasis: "a".repeat(64), reason: "Private reason" } })).status()).toBe(403);
  }
  const page = await request.get("/api/vs-compliance", { headers: f.officer.headers });
  expect(page.status()).toBe(200);
  const row = (await page.json()).rows.find((row: { memberId: string }) => row.memberId === f.member.ashedMemberId);
  const foreign = await fixture();
  const foreignHistory = await request.get(`/api/vs-compliance?eventId=${row.id}`, { headers: foreign.officer.headers });
  expect(foreignHistory.status()).toBe(404);
  expect(await foreignHistory.text()).not.toContain("Compliance Member");
  expect((await request.post(`/api/vs-compliance/tasks/${row.id}/complete`, { headers: foreign.officer.headers, data: { requestId: nanoid(), confirmationBasis: row.confirmationBasis } })).status()).toBe(404);
});

test("native officer confirmation is atomic, idempotent after later waiver, and never demotes twice", async ({ request }) => {
  const f = await fixture();
  const dashboard = await request.get("/api/vs-compliance", { headers: f.officer.headers });
  const row = (await dashboard.json()).rows.find((row: { memberId: string }) => row.memberId === f.member.ashedMemberId);
  expect(row.recommendation).toEqual({ kind: "demote", targetRank: 2 });
  const data = { requestId: nanoid(), confirmationBasis: row.confirmationBasis };
  const responses = await Promise.all([1, 2].map(() => request.post(`/api/vs-compliance/tasks/${row.id}/complete`, { headers: f.officer.headers, data })));
  expect(responses.map((response) => response.status())).toEqual([200, 200]);
  const result = await responses[0].json();
  expect(result.syncStatus).toBe("local");
  expect((await responses[1].json()).actionId).toBe(result.actionId);
  const ranks = await f.sql`SELECT id, alliance_rank FROM member_alliance_rank_events WHERE alliance_id = ${f.alliance.allianceId} AND source = 'vs_compliance'`;
  expect(ranks).toHaveLength(1); expect(ranks[0].alliance_rank).toBe(2);
  const fresh = (await (await request.get("/api/vs-compliance", { headers: f.officer.headers })).json()).rows.find((item: { id: string }) => item.id === row.id);
  const waived = await request.post(`/api/vs-compliance/tasks/${row.id}/waive`, { headers: f.officer.headers, data: { requestId: nanoid(), confirmationBasis: fresh.confirmationBasis, reason: "Private officer waiver" } });
  expect(waived.status()).toBe(200);
  const replay = await request.post(`/api/vs-compliance/tasks/${row.id}/complete`, { headers: f.officer.headers, data });
  expect(replay.status()).toBe(200); expect((await replay.json()).actionId).toBe(result.actionId);
  const roster = await f.sql`SELECT alliance_rank FROM alliance_members WHERE alliance_id = ${f.alliance.allianceId} AND ashed_member_id = ${f.member.ashedMemberId}`;
  expect(roster[0].alliance_rank).toBe(2);
  const inbox = await request.get("/api/inbox/reminders", { headers: f.officer.headers });
  expect(await inbox.text()).not.toContain("Private officer waiver");
});

test("correction and waiver rebuild later ladder recommendations and reject stale confirmation", async ({ request }) => {
  const f = await fixture("consecutive");
  const initial = (await (await request.get("/api/vs-compliance", { headers: f.officer.headers })).json()).rows[0];
  expect(initial.recommendation.kind).toBe("remove");
  await f.sql`UPDATE vs_score_heads SET score = 40000000, version = version + 1 WHERE alliance_id = ${f.alliance.allianceId} AND recorded_date = ${f.weeks[1]}`;
  const rejected = await request.post(`/api/vs-compliance/tasks/${initial.id}/complete`, { headers: f.officer.headers, data: { requestId: nanoid(), confirmationBasis: initial.confirmationBasis } });
  expect(rejected.status()).toBe(409);
  const corrected = (await (await request.get("/api/vs-compliance", { headers: f.officer.headers })).json()).rows[0];
  expect(corrected).toMatchObject({ streak: 1, recommendation: { kind: "demote", targetRank: 2 } });
  const [count] = await f.sql`SELECT count(*)::integer AS count FROM vs_compliance_actions WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(count.count).toBe(0);
});

test("native removal preserves selected pool history and does not delete HQ identities", async ({ request }) => {
  const f = await fixture("rank_aware", 1);
  const selectedId = nanoid();
  const openId = nanoid();
  await f.sql`INSERT INTO conductor_pool_entries(id, alliance_id, pool_type, generation, member_id, member_name, selected_at) VALUES (${selectedId}, ${f.alliance.allianceId}, 'r3', 1, ${f.member.ashedMemberId}, 'Compliance Member', now()), (${openId}, ${f.alliance.allianceId}, 'r3', 2, ${f.member.ashedMemberId}, 'Compliance Member', null)`;
  const row = (await (await request.get("/api/vs-compliance", { headers: f.officer.headers })).json()).rows[0];
  expect(row.recommendation.kind).toBe("remove");
  const result = await request.post(`/api/vs-compliance/tasks/${row.id}/complete`, { headers: f.officer.headers, data: { requestId: nanoid(), confirmationBasis: row.confirmationBasis } });
  expect(result.status()).toBe(200);
  expect((await result.json()).syncStatus).toBe("local");
  const roster = await f.sql`SELECT status FROM alliance_members WHERE alliance_id = ${f.alliance.allianceId} AND ashed_member_id = ${f.member.ashedMemberId}`;
  expect(roster[0].status).toBe("former");
  const pools = await f.sql`SELECT id FROM conductor_pool_entries WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(pools.map((pool) => pool.id)).toEqual([selectedId]);
  const guard = await f.sql`SELECT status FROM vs_compliance_roster_guards WHERE alliance_id = ${f.alliance.allianceId} AND member_id = ${f.member.ashedMemberId}`;
  expect(guard[0].status).toBe("former");
});

async function linkBrowserActor(f: Awaited<ReturnType<typeof fixture>>, actor = f.officer) {
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "UI Officer", allianceRank: 4 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: actor.hqUserId, ashedMemberId: linked.ashedMemberId });
}

test("browser confirms the displayed in-game action and shows HQ-only success", async ({ page, context }) => {
  const f = await fixture();
  await linkBrowserActor(f);
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/en-US/vs-compliance");
  const card = page.getByTestId("compliance-row").filter({ hasText: "Compliance Member" });
  await expect(card.getByText("Recommend R2", { exact: true })).toBeVisible();
  await expect(card.getByText("In-Game Rank: R3", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Confirm in-game action" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm in-game action" });
  await expect(dialog.getByText("Confirm only after performing the displayed action in-game.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm in-game action" }).click();
  await expect(dialog.getByText("HQ only", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Action recorded.", { exact: true })).toBeVisible();
  const rows = await f.sql`SELECT alliance_rank FROM member_alliance_rank_events WHERE alliance_id = ${f.alliance.allianceId} AND source = 'vs_compliance'`;
  expect(rows.map((row) => row.alliance_rank)).toEqual([2]);
});

test("browser stale confirmation retains the old recommendation and requires a fresh review", async ({ page, context }) => {
  const f = await fixture("consecutive");
  await linkBrowserActor(f);
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/en-US/vs-compliance");
  const card = page.getByTestId("compliance-row").filter({ hasText: "Compliance Member" });
  await card.getByRole("button", { name: "Confirm in-game action" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm in-game action" });
  await expect(dialog.getByText("Recommend removal", { exact: true })).toBeVisible();
  await f.sql`UPDATE vs_score_heads SET score = 40000000, version = version + 1 WHERE alliance_id = ${f.alliance.allianceId} AND recorded_date = ${f.weeks[1]}`;
  await dialog.getByRole("button", { name: "Confirm in-game action" }).click();
  await expect(dialog.getByRole("alert")).toContainText("The evidence, policy, or member rank changed.");
  await expect(dialog.getByText("Recommend removal", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm in-game action" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByText("Recommend R2", { exact: true })).toBeVisible();
  expect(await f.sql`SELECT id FROM vs_compliance_actions WHERE alliance_id = ${f.alliance.allianceId}`).toHaveLength(0);
});

test("browser waiver requires a private reason and retains it with a stable retry after response loss", async ({ page, context }) => {
  const f = await fixture();
  await linkBrowserActor(f);
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/en-US/vs-compliance");
  await page.getByTestId("compliance-row").filter({ hasText: "Compliance Member" }).getByRole("button", { name: "Waive this week" }).click();
  const dialog = page.getByRole("dialog", { name: "Waive this week" });
  await dialog.getByRole("button", { name: "Waive this week" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a reason for this waiver.");
  await dialog.getByLabel("Reason for waiver").fill("Private UI waiver");
  const attempts: string[] = [];
  await page.route("**/api/vs-compliance/tasks/*/waive", async (route) => {
    attempts.push(route.request().postData()!);
    const response = await route.fetch();
    if (attempts.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await dialog.getByRole("button", { name: "Waive this week" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Reason for waiver")).toHaveValue("Private UI waiver");
  await expect(dialog.getByLabel("Reason for waiver")).toBeDisabled();
  await dialog.getByRole("button", { name: "Waive this week" }).click();
  await expect(dialog.getByText("Week waived.", { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1]);
  expect(await f.sql`SELECT id FROM vs_compliance_actions WHERE alliance_id = ${f.alliance.allianceId} AND kind = 'waive'`).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/en-US/inbox");
  await expect(page.getByText("Private UI waiver", { exact: true })).toHaveCount(0);
});

test("browser missing evidence remains pending without inventing zero or a demotion", async ({ page, context }) => {
  const f = await fixture();
  await linkBrowserActor(f);
  await f.sql`DELETE FROM vs_score_heads WHERE alliance_id = ${f.alliance.allianceId}`;
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/en-US/vs-compliance");
  const card = page.getByTestId("compliance-row").filter({ hasText: "Compliance Member" });
  await expect(card.getByText("Missing evidence", { exact: true }).first()).toBeVisible();
  await expect(card.getByText("Missing, incomplete, or conflicting evidence will not create a disciplinary miss.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Confirm in-game action" })).toHaveCount(0);
  await expect(card).not.toContainText("0 points");
});

for (const role of ["member", "data_entry"] as const) test(`browser ${role} cannot read other discipline or mutate compliance`, async ({ page, context }) => {
  const f = await fixture(); const actor = await f.actor(role);
  await linkBrowserActor(f, actor);
  await context.addCookies(playwrightAuthCookies(actor));
  await page.goto("/en-US/vs-compliance");
  await expect(page.getByTestId("compliance-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm in-game action" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Waive this week" })).toHaveCount(0);
  expect((await page.request.get("/api/vs-compliance")).status()).toBe(403);
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByRole("checkbox", { name: "Enable weekly discipline" })).toHaveCount(0);
});

for (const locale of ["en-US", "pt-BR"]) test(`daily grid preserves zero and weekly-only unknowns in ${locale}`, async ({ page, context }) => {
  const f = await fixture();
  await linkBrowserActor(f);
  await f.sql`UPDATE vs_score_heads SET score = 40000000 WHERE alliance_id = ${f.alliance.allianceId} AND recorded_date = ${f.ending}`;
  const monday = addCalendarDays(f.ending, -6);
  await f.sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version) VALUES (${nanoid()}, ${f.alliance.allianceId}, ${f.member.ashedMemberId}, 'Compliance Member', ${monday}, 'daily', 0, 'hq', 1)`;
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto(`/${locale}/vs-compliance`);
  const table = page.getByTestId("compliance-row").filter({ hasText: "Compliance Member" }).getByTestId("compliance-daily-grid");
  await expect(table.getByRole("row")).toHaveCount(7);
  await expect(table.getByRole("row").nth(1)).toContainText(`0 / ${new Intl.NumberFormat(locale).format(7_200_000)}`);
  await expect(table.locator("time").first()).toHaveAttribute("datetime", monday);
  const payload = await (await page.request.get(`/api/vs-compliance?weekEnding=${f.ending}`)).json();
  const row = payload.rows.find((value: { memberId: string }) => value.memberId === f.member.ashedMemberId);
  expect(row).toMatchObject({ outcome: "passed", dailyTarget: 7_200_000 });
  expect(row.daily.slice(1).every((day: { score: number | null }) => day.score === null)).toBe(true);
  expect(JSON.stringify(row.daily)).not.toContain("hq:");
});

test("selected member history displays original actors, waiver and correction without replaying actions", async ({ page, context, request }) => {
  const f = await fixture();
  await linkBrowserActor(f);
  await f.sql`UPDATE hq_users SET display_name = 'Original Officer' WHERE id = ${f.officer.hqUserId}`;
  const row = (await (await request.get("/api/vs-compliance", { headers: f.officer.headers })).json()).rows.find((item: { memberId: string }) => item.memberId === f.member.ashedMemberId);
  const confirmed = await request.post(`/api/vs-compliance/tasks/${row.id}/complete`, { headers: f.officer.headers, data: { requestId: nanoid(), confirmationBasis: row.confirmationBasis } });
  expect(confirmed.status()).toBe(200);
  const second = await f.actor("officer");
  await f.sql`UPDATE hq_users SET display_name = 'Waiving Officer' WHERE id = ${second.hqUserId}`;
  const fresh = (await (await request.get("/api/vs-compliance", { headers: second.headers })).json()).rows.find((item: { id: string }) => item.id === row.id);
  expect((await request.post(`/api/vs-compliance/tasks/${row.id}/waive`, { headers: second.headers, data: { requestId: nanoid(), confirmationBasis: fresh.confirmationBasis, reason: "Private history waiver" } })).status()).toBe(200);
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/en-US/vs-compliance");
  const card = page.getByTestId("compliance-row").filter({ hasText: "Compliance Member" });
  await expect(card.getByText("Private history waiver")).toHaveCount(0);
  const broad = await (await page.request.get("/api/vs-compliance")).text();
  expect(broad).not.toContain("Private history waiver");
  await card.locator("summary").filter({ hasText: /^History$/ }).click();
  const history = card.getByTestId("compliance-action-history");
  await expect(history).toContainText("Original Officer");
  await expect(history).toContainText("Waiving Officer");
  await expect(history).toContainText("R3 → R2");
  await expect(history).toContainText("Private history waiver");
  await expect(history).toContainText("The evidence, policy, or member rank changed.");
  await expect(history).not.toContainText("Recommend");
  const receipt = await (await page.request.get(`/api/vs-compliance?eventId=${row.id}`)).json();
  expect(receipt.actions.map((action: { actorId: string }) => action.actorId)).toEqual([f.officer.hqUserId, second.hqUserId]);
  expect(await f.sql`SELECT id FROM member_alliance_rank_events WHERE alliance_id = ${f.alliance.allianceId} AND source = 'vs_compliance'`).toHaveLength(1);
});

test("legacy settings redirects to the guarded localized destination", async ({ page, context }) => {
  const f = await fixture();
  await linkBrowserActor(f);
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/pt-BR/settings/vs-compliance");
  await expect(page).toHaveURL(/\/pt-BR\/settings\/vs-membership-minimums$/);
  await expect(page.locator("fieldset").getByRole("checkbox")).toBeVisible();
  const member = await f.actor("member");
  await linkBrowserActor(f, member);
  await context.clearCookies();
  await context.addCookies(playwrightAuthCookies(member));
  await page.goto("/en-US/settings/vs-compliance");
  await expect(page.getByRole("checkbox", { name: "Enable weekly discipline" })).toHaveCount(0);
  await context.clearCookies();
  await page.goto("/en-US/settings/vs-compliance");
  await expect(page.getByRole("checkbox", { name: "Enable weekly discipline" })).toHaveCount(0);
  expect((await page.request.get("/api/vs-compliance?eventId=private-event")).status()).toBe(401);
});

test("new manual rank records invalidate stale confirmation and R5 remains review-only", async ({ request }) => {
  const f = await fixture();
  const row = (await (await request.get("/api/vs-compliance", { headers: f.officer.headers })).json()).rows[0];
  await f.sql`INSERT INTO member_alliance_rank_events(id, alliance_id, ashed_member_id, member_name, alliance_rank, effective_date, source) VALUES (${nanoid()}, ${f.alliance.allianceId}, ${f.member.ashedMemberId}, 'Compliance Member', 4, ${f.ending}, 'manual')`;
  expect((await request.post(`/api/vs-compliance/tasks/${row.id}/complete`, { headers: f.officer.headers, data: { requestId: nanoid(), confirmationBasis: row.confirmationBasis } })).status()).toBe(409);
  const leader = await fixture("rank_aware", 5);
  const leadership = (await (await request.get("/api/vs-compliance", { headers: leader.officer.headers })).json()).rows[0];
  expect(leadership.recommendation.kind).toBe("leadership_review");
  expect((await request.post(`/api/vs-compliance/tasks/${leadership.id}/complete`, { headers: leader.officer.headers, data: { requestId: nanoid(), confirmationBasis: leadership.confirmationBasis } })).status()).toBe(409);
});
