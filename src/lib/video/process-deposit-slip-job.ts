import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { DedupedDepositSlip } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import { depositSlipDraftToParsedRowFields } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import type { ParsedDepositSlipHistory } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
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

  const resolvedLinks = await input.timer.measureStep(
    "deposit_slip.resolve_members",
    async () => {
      // Share one alliance-tag fetch and one roster fetch per alliance across
      // the whole batch instead of re-querying per row.
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
      rawExtractJson: { ...history, slips: dedupedSlips },
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
    ocrFrameMs,
    ocrConcurrency,
    totalRawOcrRows,
  };
}
