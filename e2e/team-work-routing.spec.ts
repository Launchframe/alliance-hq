import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { ProposalSnapshot } from "../src/lib/support-teams/proposal.shared";
import type { DraftSnapshot } from "../src/lib/support-teams/draft.shared";
import { nanoid } from "nanoid";
import { authCookieHeader, createHqMemberLink, playwrightAuthCookies } from "./fixtures/db";
import { createPublishedSupportTeamFixture } from "./fixtures/support-teams";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";
import { lastClosedVsWeek } from "../src/lib/vs-compliance/workflow.shared";

async function fixture(request: APIRequestContext) {
  const f = await createPublishedSupportTeamFixture(request);
  const headers = { Cookie: authCookieHeader(f.owner) };
  const memberId = f.members[0].ashedMemberId;
  const moved = await request.post("/api/support-teams", { headers, data: { command: { kind: "move", memberId, from: null, to: f.teams[0], expectedVersion: f.version }, idempotencyKey: nanoid() } });
  expect(moved.status()).toBe(200);
  const original = (await moved.json()).event;
  const [originalSource] = await f.sql`SELECT event FROM support_team_events WHERE id = ${original.id}`;
  const member = await f.actor("member");
  await createHqMemberLink(f.sql, { allianceId: f.allianceId, hqUserId: member.hqUserId, ashedMemberId: memberId });
  const date = addCalendarDays(getServerCalendarDate(), 2);
  const absent = await request.post("/api/time-off/entries", { headers, data: { ashedMemberId: memberId, startDate: date, endDate: date, notes: "Private routing absence", requestId: nanoid() } });
  expect(absent.status()).toBe(200);
  await f.sql`INSERT INTO train_conductor_records(id, alliance_id, date, conductor_member_id, conductor_member_name, locked_at) VALUES (${nanoid()}, ${f.allianceId}, ${date}, ${memberId}, 'Member 0', now())`;
  const week = lastClosedVsWeek();
  await f.sql`INSERT INTO vs_compliance_policies(id, alliance_id, version, effective_week, enabled, weekly_minimum) VALUES (${nanoid()}, ${f.allianceId}, 1, ${week}, true, 40000000)`;
  await f.sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version) VALUES (${nanoid()}, ${f.allianceId}, ${memberId}, 'Member 0', ${week}, 'weekly', 1, 'hq', 1)`;
  expect((await request.get("/api/vs-compliance", { headers })).status()).toBe(200);
  return { ...f, member, memberId, date, original, originalSource: originalSource.event, headers };
}

test("time off, duty conflicts and VS share idempotent lead ownership without Discord links", async ({ request }) => {
  const f = await fixture(request);
  const headers = { Cookie: authCookieHeader(f.officer) };
  const snapshots = await Promise.all([1, 2].map(() => request.get("/api/team-work", { headers })));
  for (const snapshot of snapshots) expect(snapshot.status()).toBe(200);
  const body = await snapshots[0].json();
  expect(body.items.filter((item: { memberId: string }) => item.memberId === f.memberId).map((item: { kind: string }) => item.kind).sort()).toEqual(["coverage", "time_off", "vs"]);
  expect(JSON.stringify(body)).not.toMatch(/Private routing absence|game_?uid|assignmentStint|confirmationBasis|waiverReason/i);
  const tasks = await f.sql`SELECT id, assignee_id, version FROM team_work_items WHERE alliance_id = ${f.allianceId} AND member_id = ${f.memberId} AND open`;
  expect(tasks).toHaveLength(3);
  expect(tasks.every((row) => row.assignee_id === f.officer.hqUserId && row.version === 1)).toBe(true);
  const digests = await f.sql`SELECT status FROM team_work_digests WHERE alliance_id = ${f.allianceId} AND recipient_id = ${f.officer.hqUserId}`;
  expect(digests).toEqual([{ status: "pending" }]);
  const inbox = await request.get("/api/inbox/reminders", { headers });
  expect(await inbox.text()).not.toContain("Private routing absence");
  const history = await f.sql`SELECT event FROM support_team_events WHERE id = ${f.original.id}`;
  expect(history[0].event).toEqual(f.originalSource);
});

test("members see only their own obligations and published contacts, never officer work", async ({ request }) => {
  const f = await fixture(request);
  const headers = { Cookie: authCookieHeader(f.member) };
  const snapshot = await request.get("/api/team-work?scope=all", { headers });
  expect(snapshot.status()).toBe(200);
  const body = await snapshot.json();
  expect(body.items).toEqual([]);
  expect(body.members.map((row: { id: string }) => row.id)).toEqual([f.memberId]);
  expect(body.members[0].duties).toHaveLength(1);
  expect(body.teams.map((team: { name: string }) => team.name).sort()).toEqual(["Cedar", "Harbor"]);
  expect(JSON.stringify(body)).not.toMatch(/Private routing absence|recommendation|reason|game_?uid/i);
  expect((await request.post("/api/time-off/coverage", { headers, data: { coverage: { conflicts: [], note: "No elevation", requestId: nanoid() } } })).status()).toBe(403);
  expect((await request.get("/api/vs-compliance", { headers })).status()).toBe(403);
  const foreign = await createPublishedSupportTeamFixture(request);
  const cross = await request.get(`/api/team-work?scope=all&allianceId=${f.allianceId}`, { headers: { Cookie: authCookieHeader(foreign.owner) } });
  expect(await cross.text()).not.toContain(f.memberId);
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  const id = bootstrap.headers()["set-cookie"]?.match(/alliance_hq_session=([^;]+)/)?.[1];
  expect((await request.get("/api/team-work", { headers: { Cookie: `alliance_hq_session=${id}` } })).status()).toBe(403);
});

test("lead absence and revoked permission reroute unresolved work without rewriting source actors", async ({ request }) => {
  const f = await fixture(request);
  await request.get("/api/team-work", { headers: f.headers });
  const initial = await f.sql`SELECT id FROM team_work_items WHERE alliance_id = ${f.allianceId} AND member_id = ${f.memberId} AND open ORDER BY id`;
  const absent = await request.post("/api/time-off/entries", { headers: f.headers, data: { ashedMemberId: f.leads[0].ashedMemberId, startDate: getServerCalendarDate(), endDate: f.date, requestId: nanoid() } });
  expect(absent.status()).toBe(200);
  await request.get("/api/team-work?scope=all", { headers: f.headers });
  const reassigned = await f.sql`SELECT id, assignee_id FROM team_work_items WHERE alliance_id = ${f.allianceId} AND member_id = ${f.memberId} AND open ORDER BY id`;
  expect(reassigned.map((row) => ({ id: row.id }))).toEqual(initial);
  expect(reassigned.every((row) => row.assignee_id === f.owner.hqUserId)).toBe(true);
  await f.sql`UPDATE alliance_memberships SET role_id = (SELECT id FROM roles WHERE name = 'member') WHERE alliance_id = ${f.allianceId} AND hq_user_id = ${f.officer.hqUserId}`;
  const formerOfficer = await request.get("/api/team-work?scope=all", { headers: { Cookie: authCookieHeader(f.officer) } });
  expect((await formerOfficer.json()).items).toEqual([]);
  const history = await f.sql`SELECT event FROM support_team_events WHERE id = ${f.original.id}`;
  expect(history[0].event).toEqual(f.originalSource);
});

test("departed and rejoined members cannot inherit their old absence or team tasks", async ({ request }) => {
  const f = await fixture(request);
  await request.get("/api/team-work", { headers: f.headers });
  await f.sql`UPDATE member_alliance_tenure SET left_at = now() WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.memberId} AND left_at IS NULL`;
  await f.sql`INSERT INTO member_alliance_tenure(id, game_uid, alliance_id, ashed_member_id, joined_at) SELECT ${nanoid()}, game_uid, alliance_id, ashed_member_id, now() FROM member_alliance_tenure WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.memberId} ORDER BY joined_at DESC LIMIT 1`;
  const snapshot = await request.get("/api/team-work", { headers: { Cookie: authCookieHeader(f.member) } });
  const body = await snapshot.json();
  expect(body.members[0]).toMatchObject({ teamId: null, absences: [], weeks: [] });
  expect(await f.sql`SELECT id FROM team_work_items WHERE alliance_id = ${f.allianceId} AND member_id = ${f.memberId} AND open`).toHaveLength(0);
});

test("team work keeps coverage only after audit confirmation without unlocking or reassigning duties", async ({ request, page, context }) => {
  const f = await fixture(request);
  await context.addCookies(playwrightAuthCookies(f.officer));
  const before = await f.sql`SELECT id, conductor_member_id, locked_at FROM train_conductor_records WHERE alliance_id = ${f.allianceId} AND date = ${f.date}`;
  await page.goto("/en-US/team-work");
  const panel = page.getByTestId("coverage-panel");
  await expect(panel.getByRole("link", { name: "Reassign duty" })).toHaveAttribute("href", new RegExp(`/trains\\?date=${f.date}$`));
  await panel.getByRole("button", { name: "Keep assignment" }).click();
  const confirmation = page.getByTestId("coverage-confirmation");
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Keep assignment" })).toBeDisabled();
  await confirmation.getByRole("textbox", { name: "Audit note" }).fill("Coverage confirmed privately");
  await confirmation.getByRole("button", { name: "Keep assignment" }).click();
  await expect(panel.getByRole("button", { name: "Keep assignment" })).toHaveCount(0);
  await expect(page.getByTestId("team-work-items").getByRole("link", { name: "Reassign duty" })).toHaveCount(0);
  expect(await f.sql`SELECT id, conductor_member_id, locked_at FROM train_conductor_records WHERE alliance_id = ${f.allianceId} AND date = ${f.date}`).toEqual(before);
  const audits = await f.sql`SELECT hq_user_id, metadata FROM audit_log WHERE alliance_id = ${f.allianceId} AND action = 'time_off.coverage_keep'`;
  expect(audits).toHaveLength(1);
  expect(audits[0].hq_user_id).toBe(f.officer.hqUserId);
  expect(audits[0].metadata.note).toBe("Coverage confirmed privately");
  expect(await f.sql`SELECT id FROM team_work_items WHERE alliance_id = ${f.allianceId} AND kind = 'coverage' AND open`).toHaveLength(0);
  await expect(page.getByTestId("team-work")).not.toContainText("Coverage confirmed privately");
});

test("unpublished contacts and private periods never enter another member's team work", async ({ request }) => {
  const f = await fixture(request);
  const date = addCalendarDays(f.date, 1);
  await f.sql`INSERT INTO member_time_off(id, alliance_id, ashed_member_id, member_name, start_date, end_date, source, global_absence, activity_scope, notes) VALUES (${nanoid()}, ${f.allianceId}, ${f.memberId}, 'Member 0', ${date}, ${date}, 'web', false, 'vr', 'Private period marker')`;
  await f.sql`UPDATE support_team_boards SET published = false WHERE alliance_id = ${f.allianceId}`;
  const own = await (await request.get("/api/team-work?scope=all", { headers: { Cookie: authCookieHeader(f.member) } })).json();
  expect(own.teams).toEqual([]);
  expect(own.members[0].teamId).toBeNull();
  expect(own.members[0].absences).toHaveLength(2);
  const leadership = await (await request.get("/api/team-work?scope=all", { headers: f.headers })).json();
  expect(leadership.members.find((member: { id: string }) => member.id === f.memberId).absences).toHaveLength(1);
  expect(JSON.stringify(leadership.items)).not.toContain(date);
  expect(JSON.stringify(leadership)).not.toContain("Private period marker");
});

test("proposal editing and cancellation preserve routing while approved publication reroutes the private inbox and daily digests", async ({ request }) => {
  const f = await fixture(request);
  const officerHeaders = { Cookie: authCookieHeader(f.officer) };
  expect((await request.get("/api/team-work", { headers: officerHeaders })).status()).toBe(200);
  const tasks = () => f.sql`SELECT id, assignee_id, team_id, version FROM team_work_items WHERE alliance_id = ${f.allianceId} AND member_id = ${f.memberId} AND open ORDER BY id`;
  const original = await tasks();
  const inbox = async () => {
    const response = await request.get("/api/inbox/reminders", { headers: f.headers });
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toMatch(/Private routing absence|recommendation|game_?uid/i);
  };
  const create = async () => {
    const board = await (await request.get("/api/support-teams", { headers: f.headers })).json();
    const response = await request.post("/api/support-teams/proposals", { headers: f.headers, data: { expectedVersion: board.version, idempotencyKey: randomUUID() } });
    expect(response.status()).toBe(200);
    const { proposalId } = await response.json();
    const path = `/api/support-teams/proposals/${proposalId}`;
    const snapshot = async (): Promise<ProposalSnapshot> => (await request.get(path, { headers: f.headers })).json();
    const post = async (action: string, data: Record<string, unknown> = {}, headers = f.headers) => {
      const response = await request.post(`${path}/${action}`, { headers, data: { expectedVersion: (await snapshot()).proposalVersion, idempotencyKey: randomUUID(), ...data } });
      expect(response.status()).toBe(200);
      return response.json();
    };
    return { snapshot, post };
  };
  const canceled = await create();
  await canceled.post("move", { memberId: f.memberId, from: f.teams[0], to: f.teams[1] });
  await inbox();
  expect(await tasks()).toEqual(original);
  await canceled.post("cancel");
  await inbox();
  expect(await tasks()).toEqual(original);
  const proposal = await create();
  await proposal.post("move", { memberId: f.memberId, from: f.teams[0], to: f.teams[1] });
  for (const member of f.members.slice(1)) {
    const view = await proposal.snapshot();
    const team = view.teams.find((row) => row.memberIds.length < row.target)!;
    await proposal.post("move", { memberId: member.ashedMemberId, from: null, to: team.id });
  }
  await proposal.post("submit");
  await proposal.post("approve", {}, officerHeaders);
  const view = await proposal.snapshot();
  expect(view.canPublish).toBe(true);
  await proposal.post("publish", { expectedPublishedVersion: view.publishedVersion, override: false });
  await inbox();
  const published = await tasks();
  expect(published.map((row) => row.id)).toEqual(original.map((row) => row.id));
  expect(published.every((row) => row.assignee_id === f.owner.hqUserId && row.team_id === f.teams[1] && row.version === 2)).toBe(true);
  const coverage = await (await request.get(`/api/time-off/coverage?start=${f.date}&end=${f.date}`, { headers: f.headers })).json();
  expect(coverage.conflicts.find((row: { memberId: string }) => row.memberId === f.memberId).routing.hqUserId).toBe(f.owner.hqUserId);
  expect(await f.sql`SELECT recipient_id, count(*)::int AS count FROM team_work_digests WHERE alliance_id = ${f.allianceId} GROUP BY recipient_id ORDER BY recipient_id`).toEqual([f.officer.hqUserId, f.owner.hqUserId].sort().map((recipient_id) => ({ recipient_id, count: 1 })));
  const away = await request.post("/api/time-off/entries", { headers: f.headers, data: { ashedMemberId: f.leads[1].ashedMemberId, startDate: getServerCalendarDate(), endDate: f.date, requestId: nanoid() } });
  expect(away.status()).toBe(200);
  await inbox();
  expect((await tasks()).every((row) => row.assignee_id === f.officer.hqUserId && row.version === 3)).toBe(true);
  await f.sql`UPDATE alliance_memberships SET role_id = (SELECT id FROM roles WHERE name = 'member') WHERE alliance_id = ${f.allianceId} AND hq_user_id = ${f.officer.hqUserId}`;
  const revokedInbox = await request.get("/api/inbox/reminders", { headers: officerHeaders });
  expect(revokedInbox.status()).toBe(403);
  expect(await revokedInbox.text()).not.toMatch(/team_work|Private routing absence|recommendation/i);
  await inbox();
  expect((await tasks()).every((row) => row.assignee_id === null)).toBe(true);
  const memberInbox = await request.get("/api/inbox/reminders", { headers: { Cookie: authCookieHeader(f.member) } });
  expect(memberInbox.status()).toBe(403);
  expect(await memberInbox.text()).not.toMatch(/team_work|Private routing absence|recommendation/i);
  expect((await f.sql`SELECT event FROM support_team_events WHERE id = ${f.original.id}`)[0].event).toEqual(f.originalSource);
});

test("draft scheduling and cancellation preserve live work until real draft publication", async ({ request }) => {
  const f = await fixture(request);
  expect((await request.get("/api/team-work", { headers: f.headers })).status()).toBe(200);
  const tasks = () => f.sql`SELECT id, assignee_id, team_id, version FROM team_work_items WHERE alliance_id = ${f.allianceId} AND member_id = ${f.memberId} AND open ORDER BY id`;
  const original = await tasks();
  const create = async () => {
    const board = await (await request.get("/api/support-teams", { headers: f.headers })).json();
    const response = await request.post("/api/support-teams/drafts", { headers: f.headers, data: { expectedVersion: board.version, startsAt: new Date(Date.now() + 120000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), roundMinutes: 1, idempotencyKey: randomUUID() } });
    expect(response.status()).toBe(200);
    const { draftId } = await response.json();
    const path = `/api/support-teams/drafts/${draftId}`;
    const snapshot = async (): Promise<DraftSnapshot> => (await request.get(path, { headers: f.headers })).json();
    return { draftId, path, snapshot };
  };
  const canceled = await create();
  expect((await request.get("/api/inbox/reminders", { headers: f.headers })).status()).toBe(200);
  expect(await tasks()).toEqual(original);
  expect((await request.post(`${canceled.path}/cancel`, { headers: f.headers, data: { expectedVersion: (await canceled.snapshot()).version, idempotencyKey: randomUUID() } })).status()).toBe(200);
  expect((await request.get("/api/inbox/reminders", { headers: f.headers })).status()).toBe(200);
  expect(await tasks()).toEqual(original);
  const draft = await create();
  const startsKey = JSON.stringify(["draft", draft.draftId, "startsAt"]);
  const roundKey = JSON.stringify(["draft", draft.draftId, "roundStartedAt"]);
  await f.sql`UPDATE support_team_fields SET value = to_jsonb((now() - interval '1 second')::text) WHERE alliance_id = ${f.allianceId} AND key IN (${startsKey}, ${roundKey})`;
  const view = await draft.snapshot();
  expect((await request.post(`${draft.path}/pick`, { headers: f.headers, data: { teamId: f.teams[1], memberId: f.memberId, expectedRound: view.currentRound, expectedRoundVersion: view.resourceVersions.round, expectedMemberVersion: view.resourceVersions.members[f.memberId], expectedSlotVersion: view.teams.find((team) => team.id === f.teams[1])!.slotVersion, idempotencyKey: randomUUID() } })).status()).toBe(200);
  expect((await request.get("/api/inbox/reminders", { headers: f.headers })).status()).toBe(200);
  expect(await tasks()).toEqual(original);
  expect((await request.post(`${draft.path}/publish`, { headers: f.headers, data: { expectedVersion: (await draft.snapshot()).version, allowUnsorted: true, idempotencyKey: randomUUID() } })).status()).toBe(200);
  expect((await request.get("/api/inbox/reminders", { headers: f.headers })).status()).toBe(200);
  const published = await tasks();
  expect(published.map((row) => row.id)).toEqual(original.map((row) => row.id));
  expect(published.every((row) => row.assignee_id === f.owner.hqUserId && row.team_id === f.teams[1] && row.version === 2)).toBe(true);
});

test("Portuguese team work shows own contacts and keeps team filtering usable", async ({ request, page, context }) => {
  const f = await fixture(request);
  await context.addCookies(playwrightAuthCookies(f.member));
  await page.goto("/pt-BR/team-work");
  await expect(page.getByRole("heading", { name: "Trabalho em equipe", exact: true })).toBeVisible();
  await expect(page.getByText("Sua equipe é Cedar; seu líder é Lead 0.")).toBeVisible();
  await expect(page.getByTestId("team-work-items")).not.toContainText("Private routing absence");
  await page.getByRole("combobox").first().selectOption(f.teams[1]);
  await expect(page.getByTestId("team-work-members").getByRole("heading")).toHaveCount(0);
});
