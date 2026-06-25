import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  frameIndexForManualRow,
  sortIndexForManualRow,
  type ManualRowPosition,
} from "@/lib/video/manual-row-position";
import { reviewRowPrimarySortKey } from "@/lib/video/parsed-row-review-order";
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

  const [parseSession] = await db
    .select({ scoreTarget: schema.parseSessions.scoreTarget })
    .from(schema.parseSessions)
    .where(eq(schema.parseSessions.id, job.parseSessionId))
    .limit(1);

  const rowId = nanoid(16);
  const now = new Date();

  const existingRows = await db
    .select({
      frameIndex: schema.parsedRows.frameIndex,
      rank: schema.parsedRows.rank,
      allianceRank: schema.parsedRows.allianceRank,
    })
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));

  const frameIndex = frameIndexForManualRow(
    existingRows.map((row) => row.frameIndex),
    position,
  );

  const primarySortKey = reviewRowPrimarySortKey(parseSession?.scoreTarget);
  let rank: number | null = null;
  let allianceRank: number | null = null;
  if (primarySortKey === "rank") {
    rank = sortIndexForManualRow(
      existingRows.map((row) => row.rank),
      position,
    );
  } else if (primarySortKey === "allianceRank") {
    allianceRank = sortIndexForManualRow(
      existingRows.map((row) => row.allianceRank),
      position,
    );
  }

  await db.insert(schema.parsedRows).values({
    id: rowId,
    parseSessionId: job.parseSessionId,
    ocrName: "",
    score: "",
    rank,
    allianceRank,
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
      rank,
      allianceRank,
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
