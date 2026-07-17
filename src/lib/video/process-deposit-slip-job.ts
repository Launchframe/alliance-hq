import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { DedupedDepositSlip } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import { depositSlipDraftToParsedRowFields } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import {
  mergeDepositSlipHistoryParses,
  type ParsedDepositSlipHistory,
} from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import type { DetectedBankContext } from "@/lib/banks/bank-context-ocr/merge-bank-context.shared";
import {
  createDepositSlipMemberResolverCache,
  resolveDepositSlipMemberLinks,
} from "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server";
import { getDb, schema } from "@/lib/db";
import { resolveHqAllianceIdFromSession } from "@/lib/members/resolve-hq-alliance";
import {
  emptyDedupeReport,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";
import { videoFrameHasDepositSlipHistory } from "@/lib/video/deposit-slip-ocr-chunks.shared";
import { ocrDepositSlipNativeFrames } from "@/lib/video/ocr-deposit-slip-native";
import type {
  VideoOcrEngine,
  VideoOcrProgressCallback,
} from "@/lib/video/ocr-provider.shared";
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
  /** Fired as each frame's OCR settles, for the waiting-page progress bar. */
  onOcrProgress?: VideoOcrProgressCallback;
  /**
   * When false, OCR + persist per-frame history only (chunk continuation).
   * Default true — also merge and create the officer-facing parse session.
   */
  finalize?: boolean;
};

export type OcrDepositSlipVideoChunkResult = {
  hqAllianceId: string;
  ocrFrameMs: number[];
  ocrConcurrency: number;
  totalRawOcrRows: number;
  framesOcrComplete: number;
  /** Per-frame histories written this chunk (for single-shot finalize). */
  frameHistories: ParsedDepositSlipHistory[];
};

export type ProcessDepositSlipVideoParseResult = OcrDepositSlipVideoChunkResult & {
  parseSessionId: string;
  rowCount: number;
  matchedCount: number;
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

function historyFromOcrRawJson(ocrRawJson: unknown): ParsedDepositSlipHistory | null {
  if (!videoFrameHasDepositSlipHistory(ocrRawJson)) {
    return null;
  }
  const history = (ocrRawJson as { history: ParsedDepositSlipHistory }).history;
  return {
    depositPolicy: history.depositPolicy ?? null,
    minimumDeposit: history.minimumDeposit ?? null,
    slips: Array.isArray(history.slips) ? history.slips : [],
  };
}

/**
 * OCR a frame slice and persist per-frame history on `video_frames`.
 * Does not create a parse session — call {@link finalizeDepositSlipVideoParse}
 * after every frame has history (or use processDepositSlipVideoParse with
 * finalize: true for a single-shot run).
 */
export async function ocrDepositSlipVideoFrameChunk(
  input: Omit<ProcessDepositSlipVideoParseInput, "finalize" | "scoreTargetId" | "target"> & {
    scoreTargetId?: string;
    target?: ScoreTargetDef;
  },
): Promise<OcrDepositSlipVideoChunkResult> {
  const db = getDb();
  const hqAllianceId = await input.timer.measureStep(
    "alliance.resolve_hq",
    () => resolveHqAllianceIdFromSession(input.sessionId),
  );

  let ocrFrameMs: number[];
  let ocrConcurrency: number;
  let totalRawOcrRows: number;
  let frameTimings: Array<{
    frameIndex: number;
    ms: number;
    entryCount: number;
    error: string | null;
    rawLines: string[];
    history: ParsedDepositSlipHistory;
  }>;
  let detectedBankContext: DetectedBankContext | null = null;

  if (input.engine === "mock") {
    const fullHistory = input.mockHistory ?? {
      depositPolicy: null,
      minimumDeposit: null,
      slips: [],
    };
    ocrFrameMs = input.frames.map(() => 1);
    ocrConcurrency = 1;
    frameTimings = input.frames.map((frame) => {
      const slips = fullHistory.slips.filter(
        (slip) => slip.sourceFrameIndex === frame.index,
      );
      const history: ParsedDepositSlipHistory = {
        depositPolicy: fullHistory.depositPolicy,
        minimumDeposit: fullHistory.minimumDeposit,
        slips:
          slips.length > 0
            ? slips
            : frame.index === (input.frames[0]?.index ?? 0)
              ? fullHistory.slips
              : [],
      };
      return {
        frameIndex: frame.index,
        ms: 1,
        entryCount: history.slips.length,
        error: null,
        rawLines: [],
        history,
      };
    });
    totalRawOcrRows = frameTimings.reduce((sum, f) => sum + f.entryCount, 0);
    for (let i = 0; i < input.frames.length; i += 1) {
      await input.onOcrProgress?.(i + 1, input.frames.length);
    }
  } else {
    const native = await input.timer.measureStep(
      "tesseract.deposit_slip_ocr_total",
      () =>
        ocrDepositSlipNativeFrames(input.frames, {
          timer: input.timer,
          jobId: input.jobId,
          onProgress: input.onOcrProgress,
        }),
      (result) => ({
        frameCount: input.frames.length,
        rowCount: result.history.slips.length,
        autoMerged: result.dedupeReport.autoMergedCount,
        flagged: result.dedupeReport.flaggedCount,
      }),
    );
    ocrFrameMs = native.frameTimings.map((f) => f.ms);
    ocrConcurrency = native.concurrency;
    totalRawOcrRows = native.frameTimings.reduce(
      (sum, f) => sum + f.entryCount,
      0,
    );
    frameTimings = native.frameTimings;
    detectedBankContext = native.detectedBankContext;
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
          ocrRawJson: {
            lines: timing.rawLines,
            history: timing.history,
          },
        })
        .where(
          and(
            eq(schema.videoFrames.jobId, input.jobId),
            eq(schema.videoFrames.frameIndex, timing.frameIndex),
          ),
        ),
    ),
  );

  await db
    .update(schema.videoJobs)
    .set({
      allianceId: hqAllianceId,
      updatedAt: input.now,
    })
    .where(eq(schema.videoJobs.id, input.jobId));

  return {
    hqAllianceId,
    ocrFrameMs,
    ocrConcurrency,
    totalRawOcrRows,
    framesOcrComplete: frameTimings.length,
    frameHistories: frameTimings.map((timing) => timing.history),
  };
}

export async function finalizeDepositSlipVideoParse(input: {
  jobId: string;
  sessionId: string;
  scoreTargetId: string;
  timer: PipelineTimer;
  now: Date;
  /** Optional in-memory histories (single-shot path); otherwise load from frames. */
  histories?: ParsedDepositSlipHistory[];
  /**
   * When set, skip merge/dedupe and persist this history as-is (mock fixtures
   * that already carry stable slipIds / cluster ids).
   */
  historyOverride?: ParsedDepositSlipHistory;
  dedupeReport?: DedupeReport;
}): Promise<{
  parseSessionId: string;
  hqAllianceId: string;
  rowCount: number;
  matchedCount: number;
}> {
  const db = getDb();

  // Chunked OCR finalize loads from frames. If the worker died after creating
  // the parse session but before status→review, reuse the existing session
  // instead of inserting a duplicate.
  const loadFromFrames =
    input.histories == null && input.historyOverride == null;
  if (loadFromFrames) {
    const [existingJob] = await db
      .select({
        parseSessionId: schema.videoJobs.parseSessionId,
        allianceId: schema.videoJobs.allianceId,
      })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, input.jobId))
      .limit(1);
    if (existingJob?.parseSessionId) {
      const [existingSession] = await db
        .select({
          id: schema.parseSessions.id,
          allianceId: schema.parseSessions.allianceId,
          rowCount: schema.parseSessions.rowCount,
          matchedCount: schema.parseSessions.matchedCount,
        })
        .from(schema.parseSessions)
        .where(eq(schema.parseSessions.id, existingJob.parseSessionId))
        .limit(1);
      if (existingSession) {
        const hqAllianceId =
          existingSession.allianceId ??
          existingJob.allianceId ??
          (await input.timer.measureStep("alliance.resolve_hq", () =>
            resolveHqAllianceIdFromSession(input.sessionId),
          ));
        return {
          parseSessionId: existingSession.id,
          hqAllianceId,
          rowCount: existingSession.rowCount,
          matchedCount: existingSession.matchedCount,
        };
      }
    }
  }

  const hqAllianceId = await input.timer.measureStep(
    "alliance.resolve_hq",
    () => resolveHqAllianceIdFromSession(input.sessionId),
  );

  let history: ParsedDepositSlipHistory;
  let dedupeReport: DedupeReport;

  if (input.historyOverride) {
    history = input.historyOverride;
    dedupeReport =
      input.dedupeReport ?? emptyDedupeReport(history.slips.length);
  } else if (input.histories) {
    const merged = mergeDepositSlipHistoryParses(input.histories);
    history = merged.history;
    dedupeReport = input.dedupeReport ?? merged.dedupeReport;
  } else {
    const frameRows = await db
      .select({
        frameIndex: schema.videoFrames.frameIndex,
        ocrRawJson: schema.videoFrames.ocrRawJson,
      })
      .from(schema.videoFrames)
      .where(eq(schema.videoFrames.jobId, input.jobId))
      .orderBy(asc(schema.videoFrames.frameIndex));

    const parts: ParsedDepositSlipHistory[] = [];
    for (const row of frameRows) {
      const part = historyFromOcrRawJson(row.ocrRawJson);
      if (part) {
        parts.push(part);
      }
    }
    const merged = mergeDepositSlipHistoryParses(parts);
    history = merged.history;
    dedupeReport = merged.dedupeReport;
  }

  const dedupedSlips = asDedupedSlips(history.slips);
  const parseSessionId = nanoid(16);

  const resolvedLinks = await input.timer.measureStep(
    "deposit_slip.resolve_members",
    async () => {
      const resolverDeps = createDepositSlipMemberResolverCache();
      return Promise.all(
        dedupedSlips.map((slip) =>
          resolveDepositSlipMemberLinks(
            {
              bankAllianceId: hqAllianceId,
              depositAllianceTag: slip.identity.allianceTag,
              commanderName: slip.identity.commanderName,
            },
            resolverDeps,
          ),
        ),
      );
    },
  );

  const matchedCount = resolvedLinks.filter(
    (links) => links.candidateAshedMemberId != null,
  ).length;

  await input.timer.measureStep("db.create_parse_session", async () => {
    await db.insert(schema.parseSessions).values({
      id: parseSessionId,
      jobId: input.jobId,
      sessionId: input.sessionId,
      scoreTarget: input.scoreTargetId,
      allianceId: hqAllianceId,
      rowCount: dedupedSlips.length,
      matchedCount,
      status: "open",
      rawExtractJson: {
        ...history,
        slips: dedupedSlips,
        // detectedBankContext: OCR bank coords/info for review Create-bank UI
        detectedBankContext,
      },
      dedupeReportJson: dedupeReport,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });

  if (dedupedSlips.length > 0) {
    await input.timer.measureStep("db.insert_parsed_rows", async () => {
      await db.insert(schema.parsedRows).values(
        dedupedSlips.map((slip, index) => {
          const fields = depositSlipDraftToParsedRowFields(slip);
          const links = resolvedLinks[index]!;
          return {
            id: slip.slipId,
            parseSessionId,
            ocrName: fields.ocrName,
            score: fields.score,
            rank: fields.rank,
            rosterRankRaw: fields.rosterRankRaw,
            allianceRank: null,
            allianceRankTitle: fields.allianceRankTitle,
            powerLevel: fields.powerLevel,
            memberLevel: fields.memberLevel,
            profession: fields.profession,
            // Surface auto-link and below-threshold near-miss candidates for review.
            // matchMethod is "none" for near-miss-only rows so commit can prefer
            // parse-time auto-links without treating weak candidates as confirmed.
            memberId: links.candidateAshedMemberId,
            memberName: links.candidateMemberName,
            matchConfidence:
              links.candidateAshedMemberId != null
                ? links.candidateConfidence
                : null,
            matchMethod:
              links.ashedMemberId != null ? links.matchMethod : "none",
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
    matchedCount,
  };
}

export async function processDepositSlipVideoParse(
  input: ProcessDepositSlipVideoParseInput,
): Promise<ProcessDepositSlipVideoParseResult> {
  const finalize = input.finalize !== false;

  const chunk = await ocrDepositSlipVideoFrameChunk(input);

  if (!finalize) {
    return {
      ...chunk,
      parseSessionId: "",
      rowCount: 0,
      matchedCount: 0,
    };
  }

  // Mock fixtures already include stable slipIds — do not re-run merge/dedupe.
  const finalized = await finalizeDepositSlipVideoParse({
    jobId: input.jobId,
    sessionId: input.sessionId,
    scoreTargetId: input.scoreTargetId,
    timer: input.timer,
    now: input.now,
    ...(input.engine === "mock" && input.mockHistory
      ? {
          historyOverride: input.mockHistory,
          dedupeReport: emptyDedupeReport(input.mockHistory.slips.length),
        }
      : { histories: chunk.frameHistories }),
  });

  return {
    ...chunk,
    parseSessionId: finalized.parseSessionId,
    hqAllianceId: finalized.hqAllianceId,
    rowCount: finalized.rowCount,
    matchedCount: finalized.matchedCount,
  };
}
