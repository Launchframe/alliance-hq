import { nanoid } from "nanoid";
import type { APIRequestContext } from "@playwright/test";
import { authCookieHeader, createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, type SessionFixture } from "./db";

export async function createSupportTeamFixture() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, { tag: `ST${nanoid(5)}`, name: "Support fixture" });
  const actor = async (roleName: "owner" | "officer" | "member" | "viewer" | "data_entry") => {
    const session = await createAuthenticatedHqSession(sql, `support-${nanoid(8)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
    await sql`UPDATE sessions SET current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    return session;
  };
  const owner = await actor("owner");
  const officer = await actor("officer");
  const leads = await Promise.all([4, 5].map((rank, i) => createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: `Lead ${i}`, allianceRank: rank })));
  const members = await Promise.all(Array.from({ length: 6 }, (_, i) => createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: `Member ${i}`, allianceRank: 3 })));
  for (const [index, member] of [...leads, ...members].entries()) {
    await sql`INSERT INTO member_alliance_tenure (id, game_uid, alliance_id, ashed_member_id, joined_at) VALUES (${nanoid()}, ${`97${Date.now()}${index}`}, ${alliance.allianceId}, ${member.ashedMemberId}, ${new Date("2026-01-01T00:00:00Z")})`;
  }
  await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: leads[0].ashedMemberId, gameUid: `98${Date.now()}` });
  return { sql, allianceId: alliance.allianceId, owner, officer, leads, members, actor };
}

export async function seedPublishedSupportBoard(sql: ReturnType<typeof getE2eSql>, allianceId: string) {
  const key = JSON.stringify(["board", allianceId, "published"]);
  await sql`INSERT INTO support_team_fields (alliance_id, key, value, version, action_id) SELECT alliance_id, ${key}, 'true'::jsonb, version, NULL FROM support_team_boards WHERE alliance_id = ${allianceId} ON CONFLICT (alliance_id, key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, action_id = NULL`;
  await sql`UPDATE support_team_boards SET published = true WHERE alliance_id = ${allianceId}`;
}

export async function createPublishedSupportTeamFixture(request: APIRequestContext) {
  const fixture = await createSupportTeamFixture();
  await createHqMemberLink(fixture.sql, { allianceId: fixture.allianceId, hqUserId: fixture.owner.hqUserId, ashedMemberId: fixture.leads[1].ashedMemberId, gameUid: `97${Date.now()}` });
  await fixture.sql`UPDATE hq_users SET display_name = 'Owner fixture' WHERE id = ${fixture.owner.hqUserId}`;
  await fixture.sql`UPDATE hq_users SET display_name = 'Officer fixture' WHERE id = ${fixture.officer.hqUserId}`;
  const teams = [`a-${nanoid(8)}`, `b-${nanoid(8)}`];
  let version = 0;
  for (const [index, teamId] of teams.entries()) {
    for (const command of [{ kind: "createTeam", teamId, leadId: fixture.leads[index].ashedMemberId }, { kind: "rename", teamId, name: index === 0 ? "Cedar" : "Harbor" }]) {
      const response = await request.post("/api/support-teams", { headers: { Cookie: authCookieHeader(fixture.owner) }, data: { command: { ...command, expectedVersion: version }, idempotencyKey: nanoid() } });
      if (!response.ok()) throw new Error("Support fixture setup failed");
      version = (await response.json()).event.boardVersion;
    }
  }
  await seedPublishedSupportBoard(fixture.sql, fixture.allianceId);
  await fixture.sql`UPDATE alliances SET game_server_id = NULL WHERE id = ${fixture.allianceId}`;
  return { ...fixture, teams, version };
}

export async function selectSupportAlliance(session: SessionFixture, allianceId: string) {
  await getE2eSql()`UPDATE sessions SET current_alliance_id = ${allianceId} WHERE id = ${session.sessionId}`;
}
