import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createNativeAlliance, getE2eSql } from "./fixtures/db";
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
  for (const operation of ["complete", "waive"]) expect((await request.post(`/api/vs-compliance/tasks/fake/${operation}`, { data: { requestId: nanoid(), confirmationBasis: "a".repeat(64), reason: "Private reason" } })).status()).toBe(403);
  for (const role of ["member", "data_entry"] as const) {
    const actor = await f.actor(role);
    expect((await request.get("/api/vs-compliance", { headers: actor.headers })).status()).toBe(403);
    for (const operation of ["complete", "waive"]) expect((await request.post(`/api/vs-compliance/tasks/fake/${operation}`, { headers: actor.headers, data: { requestId: nanoid(), confirmationBasis: "a".repeat(64), reason: "Private reason" } })).status()).toBe(403);
  }
  const page = await request.get("/api/vs-compliance", { headers: f.officer.headers });
  expect(page.status()).toBe(200);
  const row = (await page.json()).rows.find((row: { memberId: string }) => row.memberId === f.member.ashedMemberId);
  const foreign = await fixture();
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
