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
  async function actor(roleName: "officer" | "member" | "data_entry") {
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
  return { sql, alliance, officer, member, dataEntry, roster, date };
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
    if (winner === "notice") await tx`INSERT INTO member_time_off (id, alliance_id, ashed_member_id, member_name, start_date, end_date, global_absence, availability, entry_kind, activity_scope) VALUES (${id}, ${f.alliance.allianceId}, ${f.roster.ashedMemberId}, 'Duty Member', ${f.date}, ${f.date}, true, 'full_away', 'planned', 'all')`;
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
