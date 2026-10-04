import { nanoid } from "nanoid";
import {
  createNativeAlliance, createAllianceMembership, createAllianceRosterMember,
  createAuthenticatedHqSession, createHqMemberLink, type Sql, type SessionFixture,
} from "./db";
import { insertAllianceVideoJob } from "./video-processor";

export async function createNativeVsScenario(sql: Sql) {
  const alliance = await createNativeAlliance(sql, { tag: `VS${nanoid(5)}`, name: "Native VS Test" });
  async function actor(roleName: "owner" | "officer" | "data_entry" | "member") {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    const memberName = `VS ${roleName} ${nanoid(4)}`;
    const member = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: memberName, allianceRank: roleName === "owner" ? 5 : roleName === "officer" ? 4 : 3 });
    await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, ashedMemberId: member.ashedMemberId });
    return { ...session, memberId: member.ashedMemberId, memberName };
  }
  return { ...alliance, officer: await actor("officer"), member: await actor("member"), otherOfficer: await actor("officer"), dataEntry: await actor("data_entry"), owner: await actor("owner") };
}

export async function seedVsReviewJob(sql: Sql, input: {
  allianceId: string; actor: SessionFixture; recordedDate: string;
  rows: Array<{ memberId: string; memberName: string; score: number }>;
}) {
  const jobId = await insertAllianceVideoJob(sql, { allianceId: input.allianceId, sessionId: input.actor.sessionId, enqueuedByHqUserId: input.actor.hqUserId, scoreTarget: "vs-performance", status: "review" });
  const parseSessionId = nanoid();
  await sql`INSERT INTO parse_sessions (id, job_id, session_id, score_target, alliance_id, row_count, matched_count)
    VALUES (${parseSessionId}, ${jobId}, ${input.actor.sessionId}, 'vs-performance', ${input.allianceId}, ${input.rows.length}, ${input.rows.length})`;
  await sql`UPDATE video_jobs SET parse_session_id = ${parseSessionId}, recorded_date = ${input.recordedDate} WHERE id = ${jobId}`;
  const rows = [];
  for (const [index, row] of input.rows.entries()) {
    const id = nanoid();
    await sql`INSERT INTO parsed_rows (id, parse_session_id, ocr_name, score, rank, member_id, member_name, match_confidence, match_method)
      VALUES (${id}, ${parseSessionId}, ${row.memberName}, ${String(row.score)}, ${index + 1}, ${row.memberId}, ${row.memberName}, 1, 'exact')`;
    rows.push({ ...row, id, score: String(row.score), rank: index + 1 });
  }
  return { jobId, parseSessionId, rows };
}
