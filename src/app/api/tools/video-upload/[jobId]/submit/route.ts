import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { base44BulkInsert } from "@/lib/base44/fetch";
import { parseScoreNumber } from "@/lib/video/normalize-rows";
import { findDuplicateMemberAssignments } from "@/lib/video/review-validation";

type Props = {
  params: Promise<{ jobId: string }>;
};

type SubmitRow = {
  id: string;
  memberId: string;
  memberName: string;
  score: string;
  deleted?: boolean;
};

type SubmitBody = {
  eventId: string;
  team: "A" | "B";
  recordedDate: string;
  rows: SubmitRow[];
};

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const body = (await request.json()) as SubmitBody;

    if (!body.eventId || !body.team || !body.recordedDate) {
      return NextResponse.json(
        { error: "eventId, team, and recordedDate are required." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.id, jobId),
          eq(schema.videoJobs.sessionId, session.id),
        ),
      )
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "review" && job.status !== "complete") {
      return NextResponse.json(
        { error: "Job is not ready for submit." },
        { status: 400 },
      );
    }

    const connection = await getAshedConnection(session.id);
    if (!connection) {
      return NextResponse.json({ error: "Ashed not connected" }, { status: 503 });
    }

    const allianceId = job.allianceId;
    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context missing on job." },
        { status: 400 },
      );
    }

    const activeRows = body.rows.filter(
      (r) => !r.deleted && r.memberId && r.memberName,
    );
    if (activeRows.length === 0) {
      return NextResponse.json(
        { error: "No rows to submit." },
        { status: 400 },
      );
    }

    const duplicateMembers = findDuplicateMemberAssignments(
      activeRows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        memberName: row.memberName,
      })),
    );
    if (duplicateMembers.length > 0) {
      const names = duplicateMembers.map((issue) => issue.memberName).join(", ");
      return NextResponse.json(
        {
          error: `Each member can only appear once on the leaderboard. Multiple rows map to: ${names}. Delete duplicate or incorrect rows and try again.`,
          duplicateMembers,
        },
        { status: 400 },
      );
    }

    const payload = activeRows.map((row) => ({
      alliance_id: allianceId,
      event_id: body.eventId,
      member_id: row.memberId,
      member_name: row.memberName,
      team: body.team,
      score: parseScoreNumber(row.score),
      recorded_date: body.recordedDate,
    }));

    await db
      .update(schema.videoJobs)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      sessionId: session.id,
      jobId,
      status: "submitting",
      fileName: job.fileName,
      scoreTarget: job.scoreTarget ?? job.category,
      errorMessage: null,
    });

    await base44BulkInsert(connection, "DesertStormScore", payload);

    for (const row of body.rows) {
      await db
        .update(schema.parsedRows)
        .set({
          memberId: row.memberId,
          memberName: row.memberName,
          score: row.score,
          deleted: row.deleted ? 1 : 0,
          edited: 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.parsedRows.id, row.id));
    }

    await db
      .update(schema.videoJobs)
      .set({ status: "complete", updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      sessionId: session.id,
      jobId,
      status: "complete",
      fileName: job.fileName,
      scoreTarget: job.scoreTarget ?? job.category,
      errorMessage: null,
    });

    if (job.parseSessionId) {
      await db
        .update(schema.parseSessions)
        .set({ status: "submitted", updatedAt: new Date() })
        .where(eq(schema.parseSessions.id, job.parseSessionId));
    }

    await writeAuditLog({
      sessionId: session.id,
      allianceId,
      action: "video.submit",
      resourceType: "entity",
      resourceName: "DesertStormScore",
      resourceId: jobId,
      metadata: { rowCount: activeRows.length, eventId: body.eventId },
    });

    return NextResponse.json({
      ok: true,
      submitted: activeRows.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Submit failed",
      },
      { status: 500 },
    );
  }
}
