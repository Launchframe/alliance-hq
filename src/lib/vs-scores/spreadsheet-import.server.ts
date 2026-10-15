import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { listAllianceMembers } from "@/lib/members/roster.server";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import {
  buildMemberIndex,
  matchMemberName,
} from "@/lib/video/member-matcher";
import { dedupeMatchedParseEntries } from "@/lib/video/parse-row-dedup";
import {
  isValidVsPerformanceRecordedDate,
} from "@/lib/video/vs-recorded-date.shared";
import {
  validateVsPeriod,
  type VsPeriod,
} from "@/lib/vs-scores/evidence.shared";
import {
  parseVsSpreadsheetFile,
  VsSpreadsheetFileError,
} from "@/lib/vs-scores/spreadsheet-file.server";
import type { VsSpreadsheetParseResult } from "@/lib/vs-scores/spreadsheet-import.shared";

export { VsSpreadsheetFileError };

export type VsSpreadsheetImportInput = {
  sessionId: string;
  hqUserId: string;
  allianceId: string;
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
  /** Officer override; must match the detected or chosen period. */
  recordedDate?: string | null;
  period?: VsPeriod | null;
};

export type VsSpreadsheetImportResult = {
  jobId: string;
  groupId: string;
  parseSessionId: string;
  recordedDate: string;
  period: VsPeriod;
  rowCount: number;
  matchedCount: number;
  warnings: VsSpreadsheetParseResult["warnings"];
};

export async function importVsSpreadsheetScores(
  input: VsSpreadsheetImportInput,
): Promise<VsSpreadsheetImportResult> {
  const parsed = await parseVsSpreadsheetFile({
    buffer: input.buffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });

  const period: VsPeriod =
    input.period === "daily" || input.period === "weekly"
      ? input.period
      : parsed.detectedPeriod;
  const recordedDate = (
    input.recordedDate?.trim() || parsed.detectedRecordedDate
  ).slice(0, 10);

  if (
    !isValidVsPerformanceRecordedDate(recordedDate, period) ||
    !validateVsPeriod(recordedDate, period)
  ) {
    throw new VsSpreadsheetFileError(
      "parse_failed",
      period === "weekly"
        ? "Weekly VS totals use a Sunday recorded date."
        : "Daily VS scores use a Monday–Saturday recorded date.",
    );
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);
  if (!alliance) {
    throw new VsSpreadsheetFileError("parse_failed", "Alliance not found.");
  }

  const roster = await listAllianceMembers(input.allianceId);
  const members = roster.map(allianceMemberRowToAshedMember);
  const memberIndex = members.length ? buildMemberIndex(members) : null;
  const allianceTag = alliance.tag;

  const matchedRows = parsed.rows.map((row) => ({
    entry: {
      name: row.name,
      score: row.score,
      rank: row.rank ?? undefined,
      scoreConflict: false,
    },
    match: memberIndex
      ? matchMemberName(row.name, memberIndex, { allianceTag })
      : {
          ocrName: row.name,
          memberId: null,
          memberName: null,
          confidence: 0,
          matchMethod: "none" as const,
        },
  }));

  // Spreadsheet rows are authoritative — do not apply OCR twin/ghost collapse.
  // Member-id collisions are still resolved by dedupeMatchedParseEntries.
  const dedupedRows = dedupeMatchedParseEntries(matchedRows, allianceTag);

  if (dedupedRows.length === 0) {
    throw new VsSpreadsheetFileError("no_rows");
  }

  const groupId = nanoid(16);
  const jobId = nanoid(16);
  const parseSessionId = nanoid(16);
  const now = new Date();
  let matchedCount = 0;

  await db.transaction(async (tx) => {
    await tx.insert(schema.videoUploadGroups).values({
      id: groupId,
      sessionId: input.sessionId,
      allianceId: input.allianceId,
      storageKey: null,
      fileName: input.fileName,
      fileSizeBytes: input.buffer.byteLength,
      scoreTarget: "vs-performance",
      boardKey: null,
      hqEventId: null,
      eventContext: null,
      primaryJobId: jobId,
      selectedJobId: jobId,
      accuracyJobId: null,
      comparisonJson: null,
      experimentCampaignId: null,
      experimentArmId: null,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(schema.videoJobs).values({
      id: jobId,
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      status: "review",
      fileName: input.fileName,
      fileSizeBytes: input.buffer.byteLength,
      category: "vs-performance",
      scoreTarget: "vs-performance",
      boardKey: null,
      hqEventId: null,
      eventContext: null,
      storageKey: null,
      allianceId: input.allianceId,
      bankId: null,
      recordedDate,
      enqueuedByHqUserId: input.hqUserId,
      ingestMethod: "spreadsheet",
      frameCount: 0,
      uploadedFrameCount: 0,
      parseSessionId,
      groupId,
      passKey: null,
      passIndex: null,
      passRole: "primary",
      extractionConfigJson: {
        spreadsheetImport: true,
        vsPeriod: period,
        vsRecordedDate: recordedDate,
      },
      timingsJson: {
        spreadsheetImport: true,
        vsPeriod: period,
        sourceFileName: input.fileName,
      },
      r2UploadId: null,
      expectedFileSizeBytes: input.buffer.byteLength,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(schema.parseSessions).values({
      id: parseSessionId,
      jobId,
      sessionId: input.sessionId,
      scoreTarget: "vs-performance",
      allianceId: input.allianceId,
      rowCount: dedupedRows.length,
      matchedCount: 0,
      status: "open",
      rawExtractJson: {
        source: "spreadsheet",
        fileName: input.fileName,
        period,
        recordedDate,
        warnings: parsed.warnings,
        rows: parsed.rows.map((row) => ({
          rank: row.rank,
          name: row.name,
          score: row.score,
        })),
      },
      createdAt: now,
      updatedAt: now,
    });

    for (const { entry, match } of dedupedRows) {
      if (match.memberId) matchedCount++;
      await tx.insert(schema.parsedRows).values({
        id: nanoid(16),
        parseSessionId,
        ocrName: entry.name,
        score: String(entry.score),
        rank: entry.rank ?? null,
        frontlineStage: null,
        memberId: match.memberId,
        memberName: match.memberName,
        matchConfidence: match.confidence,
        matchMethod: match.matchMethod,
        scoreConflict: entry.scoreConflict ? 1 : 0,
        frameIndex: null,
        deleted: 0,
        edited: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    await tx
      .update(schema.parseSessions)
      .set({ matchedCount, rowCount: dedupedRows.length, updatedAt: now })
      .where(eq(schema.parseSessions.id, parseSessionId));

    await writeAuditLog(
      {
        sessionId: input.sessionId,
        hqUserId: input.hqUserId,
        allianceId: input.allianceId,
        action: "vs.spreadsheet.import",
        resourceType: "video_job",
        resourceId: jobId,
        severity: "routine",
        metadata: {
          parseSessionId,
          period,
          recordedDate,
          rowCount: dedupedRows.length,
          matchedCount,
          fileName: input.fileName,
        },
      },
      tx,
    );
  });

  // Period/date live on the job (recordedDate + extractionConfigJson). Do not
  // call initializeVsVideoEvidence — that path requires hq:video:enqueue and
  // spreadsheet review never uses the VS evidence panel.

  return {
    jobId,
    groupId,
    parseSessionId,
    recordedDate,
    period,
    rowCount: dedupedRows.length,
    matchedCount,
    warnings: parsed.warnings,
  };
}
