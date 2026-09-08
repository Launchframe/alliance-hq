import { nanoid } from "nanoid";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, type SessionFixture } from "./db";

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
  await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: leads[0].ashedMemberId, gameUid: `98${Date.now()}` });
  return { sql, allianceId: alliance.allianceId, owner, officer, leads, members, actor };
}

export async function selectSupportAlliance(session: SessionFixture, allianceId: string) {
  await getE2eSql()`UPDATE sessions SET current_alliance_id = ${allianceId} WHERE id = ${session.sessionId}`;
}
