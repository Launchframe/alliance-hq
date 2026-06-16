import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ jobId: string }> };

export async function POST(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
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

  if (!job?.parseSessionId) {
    return NextResponse.json(
      { error: "Job not found or not ready" },
      { status: 404 },
    );
  }

  const rowId = nanoid(16);
  const now = new Date();
  await db.insert(schema.parsedRows).values({
    id: rowId,
    parseSessionId: job.parseSessionId,
    ocrName: "",
    score: "",
    rank: null,
    memberId: null,
    memberName: null,
    matchConfidence: null,
    matchMethod: null,
    scoreConflict: 0,
    frameIndex: null,
    deleted: 0,
    edited: 0,
    manuallyAdded: 1,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    row: {
      id: rowId,
      ocrName: "",
      score: "",
      rank: null,
      frameIndex: null,
      memberId: null,
      memberName: null,
      matchConfidence: null,
      matchMethod: null,
      scoreConflict: 0,
      deleted: 0,
      manuallyAdded: 1,
    },
  });
}
