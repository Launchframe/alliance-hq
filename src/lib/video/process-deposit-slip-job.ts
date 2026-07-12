import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { DedupedDepositSlip } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import { depositSlipDraftToParsedRowFields } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import type { ParsedDepositSlipHistory } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { getDb, schema } from "@/lib/db";
import { resolveHqAllianceIdFromSession } from "@/lib/members/resolve-hq-alliance";
import {
  emptyDedupeReport,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";
import { ocrDepositSlipNativeFrames } from "@/lib/video/ocr-deposit-slip-native";
import type { VideoOcrEngine } from "@/lib/video/ocr-provider.shared";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";
import type { ScoreTargetDef } from "@/lib/video/score-targets";

export type ProcessDepositSlipVideoParseInput = {
  jobId: string;
  sessionId: string;
  scoreTargetId: string;
  target: ScoreTargetDef;
  engine: VideoOcrEngine;
  frames: Array<{ index: number; buffer: Buffer }>;
  timer: PipelineTimer;
  now: Date;
  /** When engine is mock — pre-parsed history from fixtures. */
  mockHistory?: ParsedDepositSlipHistory;
};

export type ProcessDepositSlipVideoParseResult = {
  parseSessionId: string;
  hqAllianceId: string;
  rowCount: number;
  matchedCount: number;
  ocrFrameMs: number[];
  ocrConcurrency: number;
  totalRawOcrRows: number;
};

function asDedupedSlips(
  slips: ParsedDepositSlipHistory["slips"],
): DedupedDepositSlip[] {
  return slips.map((slip, index) => {
    const withId = slip as DedupedDepositSlip;
    if (typeof withId.slipId === "string" && withId.slipId.length > 0) {
      return withId;
    }
    return {
      ...slip,
      identity: { ...slip.identity },
      slipId: nanoid(16),
      dedupeClusterId: withId.dedupeClusterId ?? null,
      // Preserve index hint for mocks without slipId.
      sourceFrameIndex: slip.sourceFrameIndex ?? index,
    };
  });
}

export async function processDepositSlipVideoParse(
  input: ProcessDepositSlipVideoParseInput,
): Promise<ProcessDepositSlipVideoParseResult> {
  const db = getDb();
  const hqAllianceId = await input.timer.measureStep(
    "alliance.resolve_hq",
    () => resolveHqAllianceIdFromSession(input.sessionId),
  );

  let history: ParsedDepositSlipHistory;
  let dedupeReport: DedupeReport;
  let ocrFrameMs: number[];
  let ocrConcurrency: number;
  let totalRawOcrRows: number;
  let frameTimings: Array<{
    frameIndex: number;
    ms: number;
    entryCount: number;
    error: string | null;
    rawLines?: string[];
  }>;

  if (input.engine === "mock") {
    history = input.mockHistory ?? {
      depositPolicy: null,
      minimumDeposit: null,
      slips: [],
    };
    dedupeReport = emptyDedupeReport(history.slips.length);
    ocrFrameMs = input.frames.map(() => 1);
    ocrConcurrency = 1;
    totalRawOcrRows = history.slips.length;
    frameTimings = input.frames.map((frame) => ({
      frameIndex: frame.index,
      ms: 1,
      entryCount:
        history.slips.filter((s) => s.sourceFrameIndex === frame.index)
          .length ||
        (frame.index === (input.frames[0]?.index ?? 0)
          ? history.slips.length
          : 0),
      error: null,
    }));
  } else {
    const native = await input.timer.measureStep(
      "tesseract.deposit_slip_ocr_total",
      () =>
        ocrDepositSlipNativeFrames(input.frames, {
          timer: input.timer,
          jobId: input.jobId,
        }),
      (result) => ({
        frameCount: input.frames.length,
        rowCount: result.history.slips.length,
        autoMerged: result.dedupeReport.autoMergedCount,
        flagged: result.dedupeReport.flaggedCount,
      }),
    );
    history = native.history;
    dedupeReport = native.dedupeReport;
    ocrFrameMs = native.frameTimings.map((f) => f.ms);
    ocrConcurrency = native.concurrency;
    totalRawOcrRows = native.frameTimings.reduce(
      (sum, f) => sum + f.entryCount,
      0,
    );
    frameTimings = native.frameTimings;
  }

  await Promise.all(
    frameTimings.map((timing) =>
      db
        .update(schema.videoFrames)
        .set({
          uploadMs: 0,
          extractMs: timing.ms,
          ocrEntryCount: timing.entryCount,
          ocrError: timing.error,
          ocrRawJson: timing.rawLines ? { lines: timing.rawLines } : null,
        })
        .where(
          and(
            eq(schema.videoFrames.jobId, input.jobId),
            eq(schema.videoFrames.frameIndex, timing.frameIndex),
          ),
        ),
    ),
  );

  const dedupedSlips = asDedupedSlips(history.slips);
  const parseSessionId = nanoid(16);
  await input.timer.measureStep("db.create_parse_session", async () => {
    await db.insert(schema.parseSessions).values({
      id: parseSessionId,
      jobId: input.jobId,
      sessionId: input.sessionId,
      scoreTarget: input.scoreTargetId,
      allianceId: hqAllianceId,
      rowCount: dedupedSlips.length,
      matchedCount: 0,
      status: "open",
      rawExtractJson: { ...history, slips: dedupedSlips },
      dedupeReportJson: dedupeReport,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });

  if (dedupedSlips.length > 0) {
    await input.timer.measureStep("db.insert_parsed_rows", async () => {
      await db.insert(schema.parsedRows).values(
        dedupedSlips.map((slip) => {
          const fields = depositSlipDraftToParsedRowFields(slip);
          return {
            id: slip.slipId,
            parseSessionId,
            ocrName: fields.ocrName,
            score: fields.score,
            rank: null,
            rosterRankRaw: fields.rosterRankRaw,
            allianceRank: null,
            allianceRankTitle: fields.allianceRankTitle,
            powerLevel: fields.powerLevel,
            memberLevel: fields.memberLevel,
            profession: fields.profession,
            memberId: null,
            memberName: null,
            matchConfidence: null,
            matchMethod: null,
            scoreConflict: 0,
            frameIndex: fields.frameIndex,
            dedupeClusterId: slip.dedupeClusterId ?? null,
            deleted: 0,
            edited: 0,
            manuallyAdded: 0,
            createdAt: input.now,
            updatedAt: input.now,
          };
        }),
      );
    });
  }

  await db
    .update(schema.videoJobs)
    .set({
      parseSessionId,
      allianceId: hqAllianceId,
      updatedAt: input.now,
    })
    .where(eq(schema.videoJobs.id, input.jobId));

  return {
    parseSessionId,
    hqAllianceId,
    rowCount: dedupedSlips.length,
    matchedCount: 0,
    ocrFrameMs,
    ocrConcurrency,
    totalRawOcrRows,
  };
}
