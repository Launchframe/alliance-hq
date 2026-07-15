import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { getOrCreateSession } from "@/lib/session";
import { getDb, schema } from "@/lib/db";
import { getSessionAllianceTag } from "@/lib/alliance/session-alliance";
import { resolveHqAllianceIdFromSession } from "@/lib/members/resolve-hq-alliance";
import {
  allianceMemberRowToAshedMember,
  listAllianceMembers,
} from "@/lib/members/roster.server";
import { buildMemberIndex, matchMemberName } from "@/lib/video/member-matcher";
import { collapseEntriesBySanitizedName } from "@/lib/video/normalize-rows";
import { dedupeMatchedParseEntries } from "@/lib/video/parse-row-dedup";
import { loadFixtureAsOcrEntries } from "@/lib/video/vs-fixture-ocr-inject.server";
import { newVideoUploadIds } from "@/lib/video/finalize-video-upload";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev/vs-score-fixtures/snapshot
 *
 * Creates a lightweight video job in "review" status with a fully populated
 * parse session — no video file, no OCR, no Ashed connection required.
 * The fixture template provides the score data; member matching runs against
 * the local roster. The user lands on the standard review page.
 */
export async function POST(request: Request) {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getOrCreateSession();
  const body = (await request.json()) as {
    fixtureId: string;
    fixtureDayIndex?: number | null;
    scoreTarget?: string;
  };

  if (!body.fixtureId) {
    return NextResponse.json(
      { error: "fixtureId is required" },
      { status: 400 },
    );
  }

  const fixtureId = body.fixtureId;
  const fixtureDayIndex = body.fixtureDayIndex ?? null;
  const scoreTarget = body.scoreTarget ?? "vs-performance";

  const rawEntries = await loadFixtureAsOcrEntries(fixtureId, fixtureDayIndex);
  if (!rawEntries?.length) {
    return NextResponse.json(
      { error: "Fixture template is empty or not found" },
      { status: 404 },
    );
  }

  const db = getDb();
  const now = new Date();

  const allianceId = await resolveHqAllianceIdFromSession(session.id);
  const allianceTag = await getSessionAllianceTag(session.id);

  const { entries } = collapseEntriesBySanitizedName(
    rawEntries,
    allianceTag,
  );

  const hqMembers = await listAllianceMembers(allianceId);
  const members = hqMembers.map(allianceMemberRowToAshedMember);
  const memberIndex = members.length ? buildMemberIndex(members) : null;

  const matchedRows = entries.map((entry) => ({
    entry,
    match: memberIndex
      ? matchMemberName(entry.name, memberIndex, { allianceTag })
      : {
          ocrName: entry.name,
          memberId: null,
          memberName: null,
          confidence: 0,
          matchMethod: "none" as const,
        },
  }));

  const dedupedRows = dedupeMatchedParseEntries(matchedRows, allianceTag);
  let matchedCount = 0;

  const { jobId, groupId } = newVideoUploadIds();
  const parseSessionId = nanoid(16);

  await db.insert(schema.videoUploadGroups).values({
    id: groupId,
    sessionId: session.id,
    allianceId,
    storageKey: `fixture-snapshot/${jobId}`,
    fileName: `fixture-${fixtureId}.json`,
    fileSizeBytes: 0,
    scoreTarget,
    boardKey: null,
    hqEventId: null,
    primaryJobId: jobId,
    selectedJobId: jobId,
    accuracyJobId: null,
    comparisonJson: null,
    experimentCampaignId: null,
    experimentArmId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.videoJobs).values({
    id: jobId,
    sessionId: session.id,
    hqUserId: session.hqUserId ?? null,
    status: "review",
    fileName: `fixture-${fixtureId}.json`,
    fileSizeBytes: 0,
    category: scoreTarget,
    scoreTarget,
    boardKey: null,
    hqEventId: null,
    storageKey: `fixture-snapshot/${jobId}`,
    allianceId,
    enqueuedByHqUserId: session.hqUserId ?? null,
    ingestMethod: "fixture",
    frameCount: 0,
    uploadedFrameCount: 0,
    groupId,
    passKey: "primary",
    passIndex: 0,
    passRole: "primary",
    extractionConfigJson: null,
    r2UploadId: null,
    expectedFileSizeBytes: null,
    fixtureId,
    fixtureDayIndex,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.parseSessions).values({
    id: parseSessionId,
    jobId,
    sessionId: session.id,
    scoreTarget,
    allianceId,
    rowCount: dedupedRows.length,
    matchedCount: 0,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });

  for (const { entry, match } of dedupedRows) {
    if (match.memberId) matchedCount++;

    await db.insert(schema.parsedRows).values({
      id: nanoid(16),
      parseSessionId,
      ocrName: entry.name,
      score: String(entry.score),
      rank: entry.rank ?? null,
      memberId: match.memberId,
      memberName: match.memberName,
      matchConfidence: match.confidence,
      matchMethod: match.matchMethod,
      scoreConflict: entry.scoreConflict ? 1 : 0,
      frameIndex: entry._sourceFrameIndex ?? null,
      deleted: 0,
      edited: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db
    .update(schema.parseSessions)
    .set({ matchedCount, rowCount: dedupedRows.length, updatedAt: new Date() })
    .where(eq(schema.parseSessions.id, parseSessionId));

  return NextResponse.json({
    ok: true,
    jobId,
    rowCount: dedupedRows.length,
    matchedCount,
  });
}
