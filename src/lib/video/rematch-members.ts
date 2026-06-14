import { eq } from "drizzle-orm";

import { resolveSessionAllianceId, getSessionAllianceTag } from "@/lib/alliance/session-alliance";
import { base44ListMembers } from "@/lib/base44/fetch";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection } from "@/lib/session";
import {
  buildMemberIndex,
  matchMemberName,
  type AshedMember,
} from "@/lib/video/member-matcher";

export type RematchMembersResult = {
  allianceId: string;
  rowCount: number;
  matchedCount: number;
  previousAllianceId: string | null;
};

export async function rematchVideoJobMembers(
  jobId: string,
): Promise<RematchMembersResult> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (!job.parseSessionId) {
    throw new Error("Job has no parsed rows to rematch.");
  }

  const connection = await getAshedConnection(job.sessionId);
  if (!connection) {
    throw new Error("Ashed not connected for this session.");
  }

  const previousAllianceId = job.allianceId;
  const allianceId = await resolveSessionAllianceId(job.sessionId, connection);

  let members: AshedMember[] = [];
  try {
    members = await base44ListMembers(connection, allianceId);
  } catch {
    members = [];
  }

  const memberIndex = members.length ? buildMemberIndex(members) : null;
  const allianceTag = await getSessionAllianceTag(job.sessionId);
  const rows = await db
    .select()
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));

  let matchedCount = 0;
  const now = new Date();

  for (const row of rows) {
    const match = memberIndex
      ? matchMemberName(row.ocrName, memberIndex, { allianceTag })
      : {
          ocrName: row.ocrName,
          memberId: null,
          memberName: null,
          confidence: 0,
          matchMethod: "none" as const,
        };

    if (match.memberId) {
      matchedCount++;
    }

    await db
      .update(schema.parsedRows)
      .set({
        memberId: match.memberId,
        memberName: match.memberName,
        matchConfidence: match.confidence,
        matchMethod: match.matchMethod,
        updatedAt: now,
      })
      .where(eq(schema.parsedRows.id, row.id));
  }

  await db
    .update(schema.parseSessions)
    .set({
      allianceId,
      matchedCount,
      rowCount: rows.length,
      updatedAt: now,
    })
    .where(eq(schema.parseSessions.id, job.parseSessionId));

  await db
    .update(schema.videoJobs)
    .set({
      allianceId,
      updatedAt: now,
    })
    .where(eq(schema.videoJobs.id, jobId));

  return {
    allianceId,
    rowCount: rows.length,
    matchedCount,
    previousAllianceId,
  };
}
