import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";
import {
  authCookieHeader, createAllianceMembership, createAllianceRosterMember,
  createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql,
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
