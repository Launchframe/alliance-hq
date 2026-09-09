import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";
import {
  authCookieHeader, createAllianceMembership, createAllianceRosterMember,
  createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies,
} from "./fixtures/db";

async function fixture() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, { tag: `TA${nanoid(5)}`, name: "Duty Availability Alliance" });
  async function actor(roleName: "owner" | "officer" | "member" | "data_entry") {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { hqUserId: session.hqUserId, allianceId: alliance.allianceId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    return { ...session, headers: { Cookie: authCookieHeader(session) } };
  }
  const officer = await actor("officer");
  const lead = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Duty Officer", allianceRank: 4 });
  await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: lead.ashedMemberId, memberDisplayName: "Duty Officer" });
  await sql`UPDATE hq_users SET display_name = 'Duty Officer' WHERE id = ${officer.hqUserId}`;
  const member = await actor("member");
  const dataEntry = await actor("data_entry");
  const roster = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Duty Member", allianceRank: 3 });
  await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: member.hqUserId, ashedMemberId: roster.ashedMemberId, memberDisplayName: "Duty Member" });
  const date = addCalendarDays(getServerCalendarDate(), 2);
  await sql`INSERT INTO train_day_configs (id, alliance_id, date, conductor_mechanism, conductor_config, vip_mechanism, is_override)
    VALUES (${nanoid()}, ${alliance.allianceId}, ${date}, 'r3_lottery', '{"paintTemplate":"economy_week"}'::jsonb, 'none', 1)`;
  await sql`INSERT INTO conductor_pool_entries (id, alliance_id, pool_type, generation, member_id, member_name, alliance_rank, sequence_position)
    VALUES (${nanoid()}, ${alliance.allianceId}, 'r3', 1, ${roster.ashedMemberId}, 'Duty Member', 3, 1)`;
  return { sql, alliance, officer, member, dataEntry, roster, date, actor };
}

test("native train rolls deny bootstrap, members and data entry without consuming eligibility", async ({ request }) => {
  const f = await fixture();
  const data = { date: f.date };
  expect((await request.post("/api/trains/conductor/roll", { data })).status()).toBe(401);
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect((await request.post("/api/trains/conductor/roll", { data })).status()).toBe(403);
  for (const actor of [f.member, f.dataEntry]) {
    expect((await request.post("/api/trains/conductor/roll", { headers: actor.headers, data })).status()).toBe(403);
  }
  const rows = await f.sql`SELECT generation, selected_at FROM conductor_pool_entries WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(rows).toEqual([{ generation: 1, selected_at: null }]);
});

test("native global absence blocks a rotation without consuming history and cancellation restores eligibility", async ({ request }) => {
  const f = await fixture();
  const saved = await request.post("/api/time-off/entries", {
    headers: f.member.headers,
    data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: f.date, requestId: randomUUID() },
  });
  expect(saved.status()).toBe(200);
  const { entry } = await saved.json();
  const before = await f.sql`SELECT id, generation, sequence_position, selected_at, selected_for_date FROM conductor_pool_entries WHERE alliance_id = ${f.alliance.allianceId}`;
  const blocked = await request.post("/api/trains/conductor/roll", { headers: f.officer.headers, data: { date: f.date } });
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).rollError.code).toBe("POOL_UNAVAILABLE");
  expect(await f.sql`SELECT id, generation, sequence_position, selected_at, selected_for_date FROM conductor_pool_entries WHERE alliance_id = ${f.alliance.allianceId}`).toEqual(before);
  expect(await f.sql`SELECT id FROM train_conductor_records WHERE alliance_id = ${f.alliance.allianceId}`).toHaveLength(0);
  expect((await request.delete(`/api/time-off/entries/${entry.id}`, { headers: f.member.headers, data: { version: entry.version } })).status()).toBe(200);
  const rolled = await request.post("/api/trains/conductor/roll", { headers: f.officer.headers, data: { date: f.date } });
  expect(rolled.status()).toBe(200);
  expect((await rolled.json()).result.memberId).toBe(f.roster.ashedMemberId);
  const selected = await f.sql`SELECT member_id, selected_for_date FROM conductor_pool_entries WHERE alliance_id = ${f.alliance.allianceId} AND generation = 1`;
  expect(selected).toEqual([{ member_id: f.roster.ashedMemberId, selected_for_date: f.date }]);
});

async function professionFixture() {
  const f = await fixture();
  const engId = nanoid();
  const wlId = nanoid();
  const teamId = nanoid();
  const assignmentId = nanoid();
  await f.sql`INSERT INTO commanders (id, primary_name, primary_name_normalized, current_alliance_id, profession)
    VALUES (${engId}, 'Duty Member', 'duty member', ${f.alliance.allianceId}, 'Engineer'), (${wlId}, 'Duty Lead', 'duty lead', ${f.alliance.allianceId}, 'War Leader')`;
  await f.sql`INSERT INTO commander_alliance_memberships (id, commander_id, alliance_id, ashed_member_id, status)
    VALUES (${nanoid()}, ${engId}, ${f.alliance.allianceId}, ${f.roster.ashedMemberId}, 'active')`;
  await f.sql`INSERT INTO hq_user_commanders (id, hq_user_id, commander_id, is_primary) VALUES (${nanoid()}, ${f.member.hqUserId}, ${engId}, true)`;
  await f.sql`INSERT INTO wl_teams (id, alliance_id, wl_commander_id) VALUES (${teamId}, ${f.alliance.allianceId}, ${wlId})`;
  await f.sql`INSERT INTO wl_eng_assignments (id, wl_team_id, alliance_id, eng_commander_id, coverage_start_hour, coverage_end_hour)
    VALUES (${assignmentId}, ${teamId}, ${f.alliance.allianceId}, ${engId}, 22, 4)`;
  const administrator = await f.actor("owner");
  const administratorMember = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Duty Administrator", allianceRank: 5 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: administrator.hqUserId, ashedMemberId: administratorMember.ashedMemberId, memberDisplayName: "Duty Administrator" });
  return { ...f, engId, wlId, teamId, assignmentId, administrator };
}

test("configured Engineer shifts expose future multi-day overlaps, but not permanent pair duties", async ({ request }) => {
  const f = await professionFixture();
  const end = addCalendarDays(f.date, 2);
  expect((await request.post("/api/time-off/entries", { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: end, requestId: randomUUID() } })).status()).toBe(200);
  const list = await request.get("/api/time-off/coverage", { headers: f.officer.headers });
  expect(list.status()).toBe(200);
  const { conflicts } = await list.json();
  expect(conflicts).toHaveLength(6);
  expect(new Set(conflicts.map((conflict: { dutyDate: string }) => conflict.dutyDate))).toEqual(new Set([f.date, addCalendarDays(f.date, 1), end]));
  expect(conflicts.every((conflict: { dutyRole: string; assignmentId: string }) => conflict.dutyRole === "engineer" && conflict.assignmentId === f.assignmentId)).toBe(true);
  const bounded = await request.get(`/api/time-off/coverage?start=${f.date}&end=${f.date}`, { headers: f.officer.headers });
  const edge = (await bounded.json()).conflicts;
  expect(edge).toHaveLength(2);
  expect(edge[0].dutyStartAt).toBe(`${addCalendarDays(f.date, -1)}T22:00:00.000Z`);
  expect(edge[1].dutyEndAt).toBe(`${addCalendarDays(f.date, 1)}T04:00:00.000Z`);
  await f.sql`UPDATE wl_eng_assignments SET coverage_start_hour = NULL, coverage_end_hour = NULL WHERE id = ${f.assignmentId}`;
  expect((await (await request.get("/api/time-off/coverage", { headers: f.officer.headers })).json()).conflicts).toEqual([]);
  expect(await f.sql`SELECT id, wl_team_id, eng_commander_id, status FROM wl_eng_assignments WHERE id = ${f.assignmentId}`).toEqual([{ id: f.assignmentId, wl_team_id: f.teamId, eng_commander_id: f.engId, status: "active" }]);
});

test("manual profession edits deny unauthorized overrides and require current absence/window confirmation", async ({ request }) => {
  const f = await professionFixture();
  const data = { assignmentId: f.assignmentId, coverageStartHour: 21, coverageEndHour: 5 };
  expect((await request.post("/api/professions/coverage", { data })).status()).toBe(401);
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect((await request.post("/api/professions/coverage", { data })).status()).toBe(403);
  for (const actor of [f.member, f.dataEntry, f.officer]) {
    expect((await request.post("/api/professions/coverage", { headers: actor.headers, data })).status()).toBe(403);
    expect((await request.post("/api/professions/coverage", { headers: actor.headers, data: { coverageStartHour: 21, coverageEndHour: 5, coverage: { conflicts: [], note: "Confirmed", requestId: randomUUID() } } })).status()).toBe(403);
  }
  const identity = await f.sql`SELECT id, wl_team_id, eng_commander_id, assigned_at, status FROM wl_eng_assignments WHERE id = ${f.assignmentId}`;
  const pastId = nanoid();
  await f.sql`INSERT INTO train_conductor_records (id, alliance_id, date, conductor_member_id, locked_at) VALUES (${pastId}, ${f.alliance.allianceId}, ${addCalendarDays(getServerCalendarDate(), -1)}, ${f.roster.ashedMemberId}, now())`;
  const locked = await f.sql`SELECT conductor_member_id, locked_at FROM train_conductor_records WHERE id = ${pastId}`;
  const saved = await request.post("/api/time-off/entries", { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: addCalendarDays(f.date, 1), notes: "Private absence detail", requestId: randomUUID() } });
  expect(saved.status()).toBe(200);
  const { entry } = await saved.json();
  const warning = await request.post("/api/professions/coverage", { headers: f.administrator.headers, data });
  expect(warning.status()).toBe(409);
  const { conflicts } = await warning.json();
  expect(conflicts).toHaveLength(4);
  expect((await request.patch(`/api/time-off/entries/${entry.id}`, { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: addCalendarDays(f.date, 2), notes: "Changed private detail", version: entry.version } })).status()).toBe(200);
  const stale = await request.post("/api/professions/coverage", { headers: f.administrator.headers, data: { ...data, coverage: { conflicts, note: "Relief arranged", requestId: randomUUID() } } });
  expect(stale.status()).toBe(409);
  const fresh = (await stale.json()).conflicts;
  expect(fresh).toHaveLength(6);
  const changedWindow = await request.post("/api/professions/coverage", { headers: f.administrator.headers, data: { ...data, coverageEndHour: 6, coverage: { conflicts: fresh, note: "Relief arranged", requestId: randomUUID() } } });
  expect(changedWindow.status()).toBe(409);
  expect(await f.sql`SELECT coverage_start_hour, coverage_end_hour FROM wl_eng_assignments WHERE id = ${f.assignmentId}`).toEqual([{ coverage_start_hour: 22, coverage_end_hour: 4 }]);
  expect((await request.post("/api/professions/coverage", { headers: f.administrator.headers, data: { ...data, coverage: { conflicts: fresh, note: "Relief arranged", requestId: randomUUID() } } })).status()).toBe(200);
  expect(await f.sql`SELECT id, wl_team_id, eng_commander_id, assigned_at, status FROM wl_eng_assignments WHERE id = ${f.assignmentId}`).toEqual(identity);
  expect(await f.sql`SELECT conductor_member_id, locked_at FROM train_conductor_records WHERE id = ${pastId}`).toEqual(locked);
  expect((await (await request.get("/api/time-off/coverage", { headers: f.officer.headers })).json()).conflicts).toEqual([]);
  const audit = await f.sql`SELECT action, metadata FROM audit_log WHERE alliance_id = ${f.alliance.allianceId} AND action IN ('time_off.coverage_keep', 'time_off.coverage_applied')`;
  expect(audit).toHaveLength(2);
  expect(JSON.stringify(audit)).not.toContain("private detail");
  expect(JSON.stringify(audit)).not.toContain("Private absence detail");
});

test("alliance administrator edits an Engineer shift while ordinary officers retain read-only coverage",  async ({ request, page, context }) => {
  const f = await professionFixture();
  expect((await request.post("/api/time-off/entries", { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: addCalendarDays(f.date, 1), requestId: randomUUID() } })).status()).toBe(200);
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/en-US/time-off");
  const panel = page.getByTestId("coverage-panel");
  await expect(panel.locator("article")).toHaveCount(4);
  await expect(panel.locator("summary")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Keep assignment" }).first()).toBeDisabled();
  await context.addCookies(playwrightAuthCookies(f.administrator));
  await page.goto("/en-US/time-off");
  await expect(page).toHaveURL(/\/time-off$/);
  const administratorCoverage = await page.request.get("/api/time-off/coverage");
  expect(administratorCoverage.status()).toBe(200);
  expect((await administratorCoverage.json()).conflicts).toHaveLength(4);
  await expect(panel.locator("article")).toHaveCount(4);
  const duty = panel.locator("article").first();
  await duty.locator("summary").click();
  await duty.getByRole("button", { name: "Save coverage" }).click();
  const dialog = page.getByTestId("coverage-confirmation").filter({ visible: true });
  await expect(dialog.getByRole("button", { name: "Keep assignment" })).toBeDisabled();
  await dialog.getByLabel("Audit note").fill("Relief arranged");
  await dialog.getByRole("button", { name: "Keep assignment" }).click();
  await expect(panel).toContainText("No outstanding team work.");
  expect(await f.sql`SELECT id, wl_team_id, eng_commander_id, status FROM wl_eng_assignments WHERE id = ${f.assignmentId}`).toEqual([{ id: f.assignmentId, wl_team_id: f.teamId, eng_commander_id: f.engId, status: "active" }]);
});

const manualPaths = ["pick", "lock", "lock/batch", "swap", "vip/pick", "vip/lock", "roll/override", "history-import"];

test("every manual train path and coverage review denies bootstrap, member and data-entry overrides", async ({ request }) => {
  const f = await fixture();
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  for (const path of manualPaths) {
    const data = { date: f.date, memberId: f.roster.ashedMemberId, memberName: "Duty Member", allowAway: true, allowEligibilityOverride: true, coverage: { conflicts: [], note: "Confirmed", requestId: randomUUID() } };
    expect((await request.post(`/api/trains/conductor/${path}`, { data })).status()).toBe(403);
    for (const actor of [f.member, f.dataEntry]) expect((await request.post(`/api/trains/conductor/${path}`, { headers: actor.headers, data })).status()).toBe(403);
  }
  for (const headers of [undefined, f.member.headers, f.dataEntry.headers]) {
    expect((await request.get("/api/time-off/coverage", { headers })).status()).toBe(403);
    expect((await request.post("/api/time-off/coverage", { headers, data: { coverage: { conflicts: [], note: "Confirmed", requestId: randomUUID() } } })).status()).toBe(403);
  }
});

test("manual absence confirmation is version-bound and pool consumption happens only on acceptance", async ({ request }) => {
  const f = await fixture();
  const saved = await request.post("/api/time-off/entries", { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: f.date, notes: "Private absence detail", requestId: randomUUID() } });
  expect(saved.status()).toBe(200);
  const { entry } = await saved.json();
  const data = { date: f.date, memberId: f.roster.ashedMemberId, memberName: "Duty Member", allowAway: true, allowEligibilityOverride: true };
  const warning = await request.post("/api/trains/conductor/pick", { headers: f.officer.headers, data });
  expect(warning.status()).toBe(409);
  const { conflicts } = await warning.json();
  expect(JSON.stringify(conflicts)).not.toContain("Private absence detail");
  expect(await f.sql`SELECT selected_at FROM conductor_pool_entries WHERE alliance_id = ${f.alliance.allianceId}`).toEqual([{ selected_at: null }]);
  const changed = await request.patch(`/api/time-off/entries/${entry.id}`, { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: f.date, notes: "Changed private detail", version: entry.version } });
  expect(changed.status()).toBe(200);
  const stale = await request.post("/api/trains/conductor/pick", { headers: f.officer.headers, data: { ...data, coverage: { conflicts, note: "Coverage confirmed", requestId: randomUUID() } } });
  expect(stale.status()).toBe(409);
  const fresh = await stale.json();
  expect(fresh.conflicts[0].absenceVersion).not.toBe(conflicts[0].absenceVersion);
  expect((await request.post("/api/trains/conductor/pick", { headers: f.officer.headers, data: { ...data, coverage: { conflicts: fresh.conflicts, note: "Coverage confirmed", requestId: randomUUID() } } })).status()).toBe(200);
  expect(await f.sql`SELECT selected_for_date FROM conductor_pool_entries WHERE alliance_id = ${f.alliance.allianceId}`).toEqual([{ selected_for_date: f.date }]);
  const audit = await f.sql`SELECT metadata FROM audit_log WHERE alliance_id = ${f.alliance.allianceId} AND action = 'time_off.coverage_keep'`;
  expect(audit).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain("private detail");
});

test("late notice preserves locked duties and officer Keep is an audited dialog action", async ({ request, page, context }) => {
  const f = await fixture();
  const recordId = nanoid();
  await f.sql`INSERT INTO train_conductor_records (id, alliance_id, date, conductor_member_id, conductor_member_name, locked_at, locked_by_hq_user_id) VALUES (${recordId}, ${f.alliance.allianceId}, ${f.date}, ${f.roster.ashedMemberId}, 'Duty Member', now(), ${f.officer.hqUserId})`;
  const before = await f.sql`SELECT locked_at, conductor_member_id FROM train_conductor_records WHERE id = ${recordId}`;
  expect((await request.post("/api/time-off/entries", { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: f.date, requestId: randomUUID() } })).status()).toBe(200);
  const coverage = await request.get("/api/time-off/coverage", { headers: f.officer.headers });
  expect(coverage.status()).toBe(200);
  expect((await coverage.json()).conflicts).toEqual([expect.objectContaining({ assignmentId: recordId, dutyRole: "conductor", memberName: "Duty Member" })]);
  await context.addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/en-US/time-off");
  const panel = page.getByTestId("coverage-panel");
  await expect(panel).toContainText("Duty Member");
  await panel.getByRole("button", { name: "Keep assignment" }).click();
  const dialog = page.getByTestId("coverage-confirmation");
  await expect(dialog.getByRole("button", { name: "Keep assignment" })).toBeDisabled();
  await dialog.getByLabel("Audit note").fill("Relief coverage confirmed");
  await dialog.getByRole("button", { name: "Keep assignment" }).click();
  await expect(panel).toContainText("No outstanding team work.");
  expect(await f.sql`SELECT locked_at, conductor_member_id FROM train_conductor_records WHERE id = ${recordId}`).toEqual(before);
});

for (const winner of ["notice", "assignment"] as const) test(`availability transaction orders ${winner} before its concurrent writer`, async ({ request }) => {
  const f = await fixture();
  const id = nanoid();
  let release!: () => void;
  let held!: () => void;
  const acquired = new Promise<void>((resolve) => { held = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  const first = f.sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`alliance-availability:${f.alliance.allianceId}`}, 0))`;
    if (winner === "notice") await tx`INSERT INTO member_time_off (id, alliance_id, ashed_member_id, member_name, start_date, end_date, global_absence, availability, entry_kind, activity_scope, source) VALUES (${id}, ${f.alliance.allianceId}, ${f.roster.ashedMemberId}, 'Duty Member', ${f.date}, ${f.date}, true, 'full_away', 'planned', 'all', 'web')`;
    else await tx`INSERT INTO train_conductor_records (id, alliance_id, date, conductor_member_id, conductor_member_name) VALUES (${id}, ${f.alliance.allianceId}, ${f.date}, ${f.roster.ashedMemberId}, 'Duty Member')`;
    held();
    await resume;
  });
  await acquired;
  const second = winner === "notice"
    ? request.post("/api/trains/conductor/pick", { headers: f.officer.headers, data: { date: f.date, memberId: f.roster.ashedMemberId, memberName: "Duty Member", allowEligibilityOverride: true } })
    : request.post("/api/time-off/entries", { headers: f.member.headers, data: { ashedMemberId: f.roster.ashedMemberId, startDate: f.date, endDate: f.date, requestId: randomUUID() } });
  release();
  await first;
  expect((await second).status()).toBe(winner === "notice" ? 409 : 200);
  const records = await f.sql`SELECT conductor_member_id FROM train_conductor_records WHERE alliance_id = ${f.alliance.allianceId}`;
  if (winner === "notice") expect(records).toHaveLength(0);
  else {
    expect(records).toEqual([{ conductor_member_id: f.roster.ashedMemberId }]);
    expect((await (await request.get("/api/time-off/coverage", { headers: f.officer.headers })).json()).conflicts).toHaveLength(1);
  }
});
