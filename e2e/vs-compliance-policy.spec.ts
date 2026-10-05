import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { firstFullVsWeek } from "../src/lib/vs-compliance/policy.shared";
import { lastClosedVsWeek } from "../src/lib/vs-compliance/workflow.shared";
import { addCalendarDays } from "../src/lib/trains/game-time";

async function fixture() {
  const sql = getE2eSql();
  const tag = `VC${nanoid(6)}`;
  const alliance = await createNativeAlliance(sql, { tag, name: "Native Compliance Policy" });
  async function actor(roleName: "owner" | "officer" | "member" | "data_entry" | "viewer") {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    return { ...session, headers: { Cookie: authCookieHeader(session) } };
  }
  return { sql, alliance, actor, url: `/api/alliance/${tag}/vs-membership-minimums` };
}

test("compliance policy denies no-cookie, bootstrap, member, viewer and data-entry access", async ({ request }) => {
  const f = await fixture();
  const data = { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000 };
  expect((await request.get(f.url)).status()).toBe(401);
  expect((await request.patch(f.url, { data })).status()).toBe(401);
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect((await request.get(f.url)).status()).toBe(403);
  expect((await request.patch(f.url, { data })).status()).toBe(403);
  for (const role of ["member", "viewer", "data_entry"] as const) {
    const actor = await f.actor(role);
    expect((await request.get(f.url, { headers: actor.headers })).status()).toBe(403);
    expect((await request.patch(f.url, { headers: actor.headers, data })).status()).toBe(403);
  }
  const rows = await f.sql`SELECT id FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(rows).toHaveLength(0);
});

test("native officers can inspect and configure policy alongside owner-equivalent roles", async ({ request }) => {
  const f = await fixture();
  const officer = await f.actor("officer");
  const owner = await f.actor("owner");
  const data = { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5 };
  const read = await request.get(f.url, { headers: officer.headers });
  expect(read.status()).toBe(200);
  expect(await read.json()).toMatchObject({ latest: null, canManage: true, defaults: { enabled: false, dailyTarget: 7_200_000, weeklyMinimum: null } });
  expect((await request.patch(f.url, { headers: officer.headers, data })).status()).toBe(200);
  const saved = await request.patch(f.url, { headers: owner.headers, data: { ...data, expectedVersion: 1 } });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({ latest: { version: 2, enabled: true, weeklyMinimum: 40_000_000, removalThreshold: 5, preset: "consecutive" } });
  const readAgain = await request.get(f.url, { headers: officer.headers });
  const payload = await readAgain.json();
  expect(payload.history).toHaveLength(2);
  expect(JSON.stringify(payload)).not.toContain("createdByHqUserId");
  expect(JSON.stringify(payload)).not.toContain("game_uid");
  const other = await fixture();
  const otherOwner = await other.actor("owner");
  expect((await request.get(f.url, { headers: otherOwner.headers })).status()).toBe(403);
  expect((await request.patch(f.url, { headers: otherOwner.headers, data: { expectedVersion: 1, leewayPct: 5 } })).status()).toBe(403);
});

test("browser upgrades a v1 policy to v2 with explicit enable and a future effective week", async ({ page, context, request }) => {
  const f = await fixture(); const owner = await f.actor("owner");
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Policy Owner", allianceRank: 5 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: owner.hqUserId, ashedMemberId: linked.ashedMemberId });
  expect((await request.patch(f.url, { headers: owner.headers, data: { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5 } })).status()).toBe(200);
  await context.addCookies(playwrightAuthCookies(owner));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByRole("heading", { name: "VS performance policy" })).toBeVisible();
  // Upgrading an enabled v1 policy must not auto-activate the v2 draft.
  const enable = page.locator("form").getByRole("checkbox", { name: "Enable VS performance policy" });
  await expect(enable).not.toBeChecked();
  await expect(page.getByLabel("Daily minimum", { exact: true })).toHaveValue("7200000");
  await expect(page.getByLabel("Missed days allowed per week", { exact: true })).toHaveValue("0");
  await expect(page.getByTestId("vs-policy-history-row")).toContainText("Earlier weekly-minimum policy");
  await expect(page.getByTestId("vs-policy-history-row")).toContainText("Weekly VS minimum");
  await expect(page.getByTestId("vs-policy-history-row")).toContainText("Daily VS target");
  await expect(page.getByTestId("vs-policy-history-row")).not.toContainText("Daily minimum");
  await expect(page.getByTestId("vs-policy-history-row")).toContainText("Enable weekly discipline");
  await page.getByLabel("Daily minimum", { exact: true }).fill("40000000");
  await page.getByLabel("Missed days allowed per week", { exact: true }).fill("1");
  const effective = addCalendarDays(firstFullVsWeek(new Date()), 7);
  await page.getByLabel("Effective VS week", { exact: true }).fill(effective);
  await enable.check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Policy settings saved.", { exact: true })).toBeVisible();
  const rows = await f.sql`SELECT version, enabled, model_version, daily_target, effective_week, allowed_missed_days, demotion_unit, demotion_length, promotion_unit, promotion_length FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId} ORDER BY version`;
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ version: 2, enabled: true, model_version: 2, effective_week: effective, allowed_missed_days: 1, demotion_unit: "weeks", demotion_length: 1, promotion_unit: "weeks", promotion_length: 2 });
  expect(Number(rows[1].daily_target)).toBe(40_000_000);
  await expect(page.getByTestId("vs-policy-history-row").first()).toContainText("Daily-consistency policy");
  await expect(page.getByTestId("vs-policy-history-row").first()).toContainText("Enable VS performance policy");
  await expect(page.getByTestId("vs-policy-history-row").first()).toContainText("Daily minimum");
  await expect(page.getByTestId("vs-policy-history-row").first()).not.toContainText("Daily VS target");
  await page.goto("/pt-BR/settings/vs-membership-minimums");
  await expect(page.getByTestId("vs-policy-history-row").nth(0)).toContainText("Mínimo diário");
  await expect(page.getByTestId("vs-policy-history-row").nth(0)).toContainText("Ativar política de desempenho VS");
  await expect(page.getByTestId("vs-policy-history-row").nth(1)).toContainText("Meta diária de VS");
  await expect(page.getByTestId("vs-policy-history-row").nth(1)).toContainText("Ativar disciplina semanal");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByRole("heading", { name: "VS performance policy" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("browser preview is read-only, neutral on missing evidence, and invalidates on draft change", async ({ page, context }) => {
  const f = await fixture(); const officer = await f.actor("officer");
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Policy Officer", allianceRank: 4 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: linked.ashedMemberId });
  const member = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Preview Member", allianceRank: 3 });
  const missing = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Preview Missing", allianceRank: 3 });
  await f.sql`UPDATE alliance_members SET join_date = '2020-01-01' WHERE alliance_id = ${f.alliance.allianceId} AND ashed_member_id IN (${member.ashedMemberId}, ${missing.ashedMemberId})`;
  const weekEnding = addCalendarDays(lastClosedVsWeek(), -70);
  for (let index = 0; index < 6; index++) await f.sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version) VALUES (${nanoid()}, ${f.alliance.allianceId}, ${member.ashedMemberId}, 'Preview Member', ${addCalendarDays(weekEnding, index - 6)}, 'daily', 0, 'hq', 1)`;
  await context.addCookies(playwrightAuthCookies(officer));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByRole("heading", { name: "VS performance policy" })).toBeVisible();
  await page.locator("form").getByRole("checkbox", { name: "Enable VS performance policy" }).check();
  await page.getByLabel("Daily minimum", { exact: true }).fill("7200000");
  await page.getByLabel("Missed days allowed per week", { exact: true }).fill("0");
  const [auditBefore] = await f.sql`SELECT count(*)::integer AS count FROM audit_log WHERE alliance_id = ${f.alliance.allianceId}`;
  await page.getByLabel("Closed VS week to preview", { exact: true }).fill(weekEnding);
  await page.getByRole("button", { name: "Preview policy" }).click();
  const results = page.getByTestId("vs-policy-preview-results");
  await expect(results).toBeVisible();
  await expect(results).toContainText(`Preview for week ending ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${weekEnding}T12:00:00Z`))}`);
  await expect(results).toContainText("Preview Member");
  await expect(results).toContainText("Below minimum");
  await expect(results).toContainText("Recommend R2");
  await expect(results).toContainText("Preview Missing");
  await expect(results).toContainText("Needs evidence");
  await expect(results.getByText("Some scores are missing or unverified; these results are incomplete.")).toBeVisible();
  await expect(page.getByText("Preview only. This does not change historical results or create rank actions.")).toBeVisible();
  // Preview must not write policies, actions, or audit rows.
  expect(await f.sql`SELECT id FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId}`).toHaveLength(0);
  expect(await f.sql`SELECT id FROM vs_compliance_actions WHERE alliance_id = ${f.alliance.allianceId}`).toHaveLength(0);
  const [auditAfter] = await f.sql`SELECT count(*)::integer AS count FROM audit_log WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(auditAfter.count).toBe(auditBefore.count);
  // Changing the draft invalidates the rendered preview.
  await page.getByLabel("Missed days allowed per week", { exact: true }).fill("5");
  await expect(results).toHaveCount(0);
});

test("browser preview rejects open weeks and never renders a mismatched server week", async ({ page, context }) => {
  const f = await fixture(); const officer = await f.actor("officer");
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Policy Officer", allianceRank: 4 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: linked.ashedMemberId });
  await context.addCookies(playwrightAuthCookies(officer));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByRole("heading", { name: "VS performance policy" })).toBeVisible();
  const results = page.getByTestId("vs-policy-preview-results");
  await page.getByLabel("Closed VS week to preview", { exact: true }).fill(addCalendarDays(lastClosedVsWeek(), 7));
  await page.getByRole("button", { name: "Preview policy" }).click();
  await expect(page.getByText("Choose a completed VS week to preview.", { exact: true })).toBeVisible();
  await expect(results).toHaveCount(0);
  const weekEnding = lastClosedVsWeek();
  await page.route("**/api/vs-performance/policy-preview", async (route) => {
    await route.fulfill({ json: { weekEnding: addCalendarDays(weekEnding, -7), rows: [{ memberId: "m", memberName: "Stale Member", currentRank: 3, outcome: "missed", counts: null, recommendationKind: "demote", recommendationTargetRank: 2, signal: null }] } });
  });
  await page.getByLabel("Closed VS week to preview", { exact: true }).fill(weekEnding);
  await page.getByRole("button", { name: "Preview policy" }).click();
  await expect(page.getByText("Could not preview this policy. Try again.", { exact: true })).toBeVisible();
  await expect(results).toHaveCount(0);
  await expect(page.getByText("Stale Member")).toHaveCount(0);
});

test("browser preview shows advisory promotion and concern signals without actions", async ({ page, context }) => {
  const f = await fixture(); const officer = await f.actor("officer");
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Policy Officer", allianceRank: 4 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: linked.ashedMemberId });
  const weekEnding = lastClosedVsWeek();
  await page.route("**/api/vs-performance/policy-preview", async (route) => {
    await route.fulfill({ json: { weekEnding, rows: [
      { memberId: "m1", memberName: "Rising Member", currentRank: 3, outcome: "passed", counts: null, recommendationKind: "none", recommendationTargetRank: null, signal: { kind: "promotion", targetRank: 4, reached: true } },
      { memberId: "m2", memberName: "Fading Member", currentRank: 3, outcome: "missed", counts: null, recommendationKind: "none", recommendationTargetRank: null, signal: { kind: "concern", targetRank: null, reached: false } },
      { memberId: "m3", memberName: "Quiet Member", currentRank: 3, outcome: "passed", counts: null, recommendationKind: "none", recommendationTargetRank: null, signal: { kind: "promotion", targetRank: null, reached: false } },
    ] } });
  });
  await context.addCookies(playwrightAuthCookies(officer));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByRole("heading", { name: "VS performance policy" })).toBeVisible();
  await page.getByLabel("Closed VS week to preview", { exact: true }).fill(weekEnding);
  await page.getByRole("button", { name: "Preview policy" }).click();
  const results = page.getByTestId("vs-policy-preview-results");
  await expect(results).toBeVisible();
  await expect(results).toContainText("Rising Member");
  await expect(results).toContainText("Showing potential for R4");
  await expect(results).toContainText("Fading Member");
  await expect(results).toContainText("On track for demotion");
  await expect(results).toContainText("Quiet Member");
  await expect(results).toContainText("Promotion potential");
  await expect(page.getByText("Preview only. This does not change historical results or create rank actions.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm in-game action" })).toHaveCount(0);
  expect(await f.sql`SELECT id FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId}`).toHaveLength(0);
  expect(await f.sql`SELECT id FROM vs_compliance_actions WHERE alliance_id = ${f.alliance.allianceId}`).toHaveLength(0);
});

test("browser officers can edit settings and stale owner saves retain inputs", async ({ page, context }) => {
  const f = await fixture(); const owner = await f.actor("owner"); const officer = await f.actor("officer");
  for (const actor of [owner, officer]) {
    const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: `Policy ${actor.hqUserId}`, allianceRank: 4 });
    await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: actor.hqUserId, ashedMemberId: linked.ashedMemberId });
  }
  await context.addCookies(playwrightAuthCookies(officer));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByLabel("Daily minimum", { exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await context.addCookies(playwrightAuthCookies(owner));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await page.getByLabel("Missed days allowed per week", { exact: true }).fill("2");
  expect((await page.request.patch(f.url, { data: { expectedVersion: 0, modelVersion: 2, enabled: false, dailyTarget: 7_200_000, leewayPct: 0, allowedMissedDays: 0, demotion: { unit: "weeks", length: 1 }, promotion: { unit: "weeks", length: 2 }, effectiveWeek: firstFullVsWeek(new Date()) } })).status()).toBe(200);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#hq-app-shell").getByRole("alert").filter({ hasText: "This policy changed while you were editing." })).toBeVisible();
  await expect(page.getByLabel("Missed days allowed per week", { exact: true })).toHaveValue("2");
});

test("browser /vs-compliance redirects to VS performance with closed week or member detail", async ({ page, context, request }) => {
  const f = await fixture(); const officer = await f.actor("officer");
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Redirect Officer", allianceRank: 4 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: linked.ashedMemberId });
  const member = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Redirect Member", allianceRank: 3 });
  const weekEnding = lastClosedVsWeek();
  await f.sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version) VALUES (${nanoid()}, ${f.alliance.allianceId}, ${member.ashedMemberId}, 'Redirect Member', ${weekEnding}, 'weekly', 1, 'hq', 1)`;
  const rows = (await (await request.get("/api/vs-compliance", { headers: officer.headers })).json()).rows;
  const row = rows.find((value: { memberId: string }) => value.memberId === member.ashedMemberId);
  await context.addCookies(playwrightAuthCookies(officer));
  await page.goto("/en-US/vs-compliance");
  await expect(page).toHaveURL(/\/vs-performance\?week=\d{4}-\d{2}-\d{2}/);
  await page.goto(`/en-US/vs-compliance?weekEnding=${weekEnding}`);
  await expect(page).toHaveURL(new RegExp(`/vs-performance\\?week=${addCalendarDays(weekEnding, -6)}`));
  await page.goto(`/en-US/vs-compliance?eventId=${row.id}`);
  await expect(page).toHaveURL(new RegExp(`/vs-performance/members/${member.ashedMemberId}\\?week=${addCalendarDays(weekEnding, -6)}`));
  await page.goto("/en-US/vs-compliance?eventId=unknown-event");
  await expect(page.getByText("Page not found", { exact: true })).toBeVisible();
  const foreign = await fixture();
  const foreignOfficer = await foreign.actor("officer");
  const foreignLinked = await createAllianceRosterMember(foreign.sql, { allianceId: foreign.alliance.allianceId, currentName: "Foreign Officer", allianceRank: 4 });
  await createHqMemberLink(foreign.sql, { allianceId: foreign.alliance.allianceId, hqUserId: foreignOfficer.hqUserId, ashedMemberId: foreignLinked.ashedMemberId });
  await context.clearCookies();
  await context.addCookies(playwrightAuthCookies(foreignOfficer));
  await page.goto(`/en-US/vs-compliance?eventId=${row.id}`);
  await expect(page.getByText("Page not found", { exact: true })).toBeVisible();
  await expect(page.getByText("Redirect Member")).toHaveCount(0);
});

test("policy PATCH preserves history, rejects retroactivity, and serializes stale double submissions", async ({ request }) => {
  const f = await fixture();
  const owner = await f.actor("owner");
  const created = await request.patch(f.url, { headers: owner.headers, data: { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5 } });
  expect(created.status()).toBe(200);
  const first = (await created.json()).latest;
  const results = await Promise.all([5, 10].map((leewayPct) => request.patch(f.url, { headers: owner.headers, data: { expectedVersion: 1, leewayPct } })));
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  const read = await request.get(f.url, { headers: owner.headers });
  const policy = await read.json();
  expect(policy.history).toHaveLength(2);
  expect(policy.history[1]).toEqual(first);
  expect(policy.latest).toMatchObject({ version: 2, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5, effectiveWeek: first.effectiveWeek });
  expect((await request.patch(f.url, { headers: owner.headers, data: { expectedVersion: 2, effectiveWeek: "2020-01-05", weeklyMinimum: 80_000_000 } })).status()).toBe(400);
  const rows = await f.sql`SELECT version, created_by_hq_user_id FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId} ORDER BY version`;
  expect(rows.map((row) => row.version)).toEqual([1, 2]);
  expect(rows.every((row) => row.created_by_hq_user_id === owner.hqUserId)).toBe(true);
});
