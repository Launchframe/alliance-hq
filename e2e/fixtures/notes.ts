import { nanoid } from "nanoid";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql } from "./db";

export async function createNotesFixture(peerRole: "viewer" | "officer" = "viewer") {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, { tag: `NWS${nanoid(4)}`, name: "Notes Workspace" });
  const author = await createAuthenticatedHqSession(sql, `notes-author-${nanoid(8)}@e2e.test`);
  const peer = await createAuthenticatedHqSession(sql, `notes-reader-${nanoid(8)}@e2e.test`);
  const cookie = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Cookie", allianceRank: 4 });
  const ferg = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Ferg", allianceRank: peerRole === "officer" ? 4 : 3 });
  for (const [person, member, roleName, name] of [[author, cookie, "officer", "Cookie"], [peer, ferg, peerRole, "Ferg"]] as const) {
    await createAllianceMembership(sql, { hqUserId: person.hqUserId, allianceId: alliance.allianceId, roleName, source: "manual" });
    await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: person.hqUserId, ashedMemberId: member.ashedMemberId, memberDisplayName: name });
    await sql`UPDATE sessions SET current_alliance_id = ${alliance.allianceId} WHERE id = ${person.sessionId}`;
  }
  return { author, peer, cookie, ferg, alliance };
}
