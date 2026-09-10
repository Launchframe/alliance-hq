import { createHash, randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { recordChanges } from "../../src/lib/support-teams/policy.shared";
import type { SupportBoard } from "../../src/lib/support-teams/types.shared";
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
  await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: owner.hqUserId, ashedMemberId: leads[1].ashedMemberId, gameUid: `96${Date.now()}` });
  return { sql, allianceId: alliance.allianceId, owner, officer, leads, members, actor };
}

export async function seedPublishedSupportBoard(sql: ReturnType<typeof getE2eSql>, allianceId: string) {
  return sql.begin(async (tx) => {
    const [stored] = await tx`SELECT version, published, construction FROM support_team_boards WHERE alliance_id = ${allianceId} FOR UPDATE`;
    const fields = await tx`SELECT key, value, version, action_id FROM support_team_fields WHERE alliance_id = ${allianceId}`;
    const board: SupportBoard = { allianceId, version: stored.version, published: stored.published, construction: stored.construction, fields: Object.fromEntries(fields.map((field) => [field.key, { value: field.value, version: field.version, actionId: field.action_id }])) };
    const key = JSON.stringify(["board", allianceId, "published"]);
    const result = recordChanges(board, { allianceId, principalId: "service:support-team-fixture", canRead: true, canWrite: true, override: true, linkedMemberIds: [] }, { [key]: true }, [], { mode: "setup" }, "publishDraft", { id: randomUUID(), at: new Date().toISOString(), idempotencyKey: randomUUID() });
    result.event.actorType = "service";
    result.event.principalType = "service";
    const patch = result.event.patches[0];
    await tx`INSERT INTO support_team_fields (alliance_id, key, value, version, action_id) VALUES (${allianceId}, ${key}, 'true'::jsonb, ${patch.afterVersion}, ${result.event.id}) ON CONFLICT (alliance_id, key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, action_id = EXCLUDED.action_id`;
    await tx`INSERT INTO support_team_events (id, alliance_id, principal_id, idempotency_key, request_hash, board_version, event) VALUES (${result.event.id}, ${allianceId}, ${result.event.principalId}, ${result.event.idempotencyKey}, ${createHash("sha256").update(JSON.stringify(result.event.patches)).digest("hex")}, ${result.board.version}, ${tx.json(result.event)})`;
    await tx`UPDATE support_team_boards SET published = true, version = ${result.board.version} WHERE alliance_id = ${allianceId}`;
    return result.board.version;
  });
}

export async function createPublishedSupportTeamFixture(request: APIRequestContext) {
  const fixture = await createSupportTeamFixture();
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
  version = await seedPublishedSupportBoard(fixture.sql, fixture.allianceId);
  await fixture.sql`UPDATE alliances SET game_server_number = 0, game_server_id = (SELECT id FROM game_servers WHERE server_number = 0) WHERE id = ${fixture.allianceId}`;
  return { ...fixture, teams, version };
}

export async function selectSupportAlliance(session: SessionFixture, allianceId: string) {
  await getE2eSql()`UPDATE sessions SET current_alliance_id = ${allianceId} WHERE id = ${session.sessionId}`;
}
