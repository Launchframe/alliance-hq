import { nanoid } from "nanoid";
import {
  createNativeAlliance, createAllianceMembership, createAllianceRosterMember,
  createAuthenticatedHqSession, createHqMemberLink, type Sql, type SessionFixture,
} from "./db";
import { insertAllianceVideoJob } from "./video-processor";

export async function createNativeFrontlineScenario(sql: Sql) {
  const alliance = await createNativeAlliance(sql, { tag: `FL${nanoid(5)}`, name: "Native Frontline Test" });
  async function actor(roleName: "owner" | "officer" | "data_entry" | "member") {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    const memberName = `FL ${roleName} ${nanoid(4)}`;
    const member = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: memberName, allianceRank: roleName === "owner" ? 5 : roleName === "officer" ? 4 : 3 });
    await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, ashedMemberId: member.ashedMemberId });
    return { ...session, memberId: member.ashedMemberId, memberName };
  }
  return { ...alliance, officer: await actor("officer"), member: await actor("member"), otherOfficer: await actor("officer"), dataEntry: await actor("data_entry"), owner: await actor("owner") };
}

export async function createFrontlineEvent(sql: Sql, input: {
  allianceId: string;
  name?: string;
  scoreTarget?: string;
}) {
  const id = nanoid(16);
  await sql`
    INSERT INTO hq_events (id, alliance_id, score_target, name, status)
    VALUES (${id}, ${input.allianceId}, ${input.scoreTarget ?? 'frontline-breakthrough'}, ${input.name ?? `Frontline ${nanoid(4)}`}, 'active')
  `;
  return { id };
}

export async function seedFrontlineReviewJob(sql: Sql, input: {
  allianceId: string;
  actor: SessionFixture;
  recordedDate: string;
  hqEventId?: string;
  rows: Array<{ memberId: string; memberName: string; score: number; frontlineStage: number; rank?: number }>;
}) {
  const jobId = await insertAllianceVideoJob(sql, {
    allianceId: input.allianceId,
    sessionId: input.actor.sessionId,
    enqueuedByHqUserId: input.actor.hqUserId,
    scoreTarget: "frontline-breakthrough",
    status: "review",
  });
  const parseSessionId = nanoid();
  await sql`INSERT INTO parse_sessions (id, job_id, session_id, score_target, alliance_id, row_count, matched_count)
    VALUES (${parseSessionId}, ${jobId}, ${input.actor.sessionId}, 'frontline-breakthrough', ${input.allianceId}, ${input.rows.length}, ${input.rows.length})`;
  await sql`UPDATE video_jobs SET parse_session_id = ${parseSessionId}, recorded_date = ${input.recordedDate}, hq_event_id = ${input.hqEventId ?? null} WHERE id = ${jobId}`;
  const rows = [];
  for (const [index, row] of input.rows.entries()) {
    const id = nanoid();
    await sql`INSERT INTO parsed_rows (id, parse_session_id, ocr_name, score, rank, frontline_stage, member_id, member_name, match_confidence, match_method)
      VALUES (${id}, ${parseSessionId}, ${row.memberName}, ${String(row.score)}, ${row.rank ?? index + 1}, ${row.frontlineStage}, ${row.memberId}, ${row.memberName}, 1, 'exact')`;
    rows.push({ ...row, id, score: String(row.score), rank: row.rank ?? index + 1 });
  }
  return { jobId, parseSessionId, rows };
}
