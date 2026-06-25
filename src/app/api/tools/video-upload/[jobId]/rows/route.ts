import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  frameIndexForManualRow,
  type ManualRowPosition,
} from "@/lib/video/manual-row-position";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
  const db = getDb();

  let position: ManualRowPosition = "end";
  try {
    const body = (await request.json()) as { position?: ManualRowPosition };
    if (body.position === "start" || body.position === "end") {
      position = body.position;
    }
  } catch {
    // Empty body defaults to end.
  }

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

  if (job.status !== "review") {
    return NextResponse.json(
      { error: "Manual rows can only be added during review." },
      { status: 400 },
    );
  }

  if (!job.parseSessionId) {
    return NextResponse.json(
      { error: "Job is not ready for manual rows." },
      { status: 400 },
    );
  }

  const rowId = nanoid(16);
  const now = new Date();

  const existingRows = await db
    .select({ frameIndex: schema.parsedRows.frameIndex })
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));

  const frameIndex = frameIndexForManualRow(
    existingRows.map((row) => row.frameIndex),
    position,
  );

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
    frameIndex,
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
      frameIndex,
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
