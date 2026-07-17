import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { getSessionAllianceTag } from "@/lib/alliance/session-alliance";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import { DEFAULT_ROSTER_OCR_CONFIG, type RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { resolveHqAllianceIdFromSession } from "@/lib/members/resolve-hq-alliance";
import {
  allianceMemberRowToAshedMember,
  listAllianceMembers,
  syncAllianceMembersFromAshed,
} from "@/lib/members/roster.server";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";
import {
  buildMemberIndex,
  matchMemberName,
} from "@/lib/video/member-matcher";
import { mockOcrRosterFrames } from "@/lib/video/ocr-mock";
import { ocrRosterAllFrames } from "@/lib/video/ocr-roster-pipeline";
import { ocrRosterNativeFrames } from "@/lib/video/ocr-roster-native";
import type {
  VideoOcrEngine,
  VideoOcrProgressCallback,
} from "@/lib/video/ocr-provider.shared";
import type { ScoreTargetDef } from "@/lib/video/score-targets";
import type { ExtractedRosterMember } from "@/lib/video/roster-extract";

export type ProcessRosterVideoParseInput = {
  jobId: string;
  sessionId: string;
  scoreTargetId: string;
  target: ScoreTargetDef;
  connection: ParsedConnection | null;
  engine: VideoOcrEngine;
  rosterConfig?: RosterOcrConfig;
  rosterPassKey?: string | null;
  frames: Array<{ index: number; buffer: Buffer }>;
  timer: PipelineTimer;
  now: Date;
  /** Fired as each frame's OCR settles, for the waiting-page progress bar. */
  onOcrProgress?: VideoOcrProgressCallback;
};

export type ProcessRosterVideoParseResult = {
  parseSessionId: string;
  hqAllianceId: string;
  rowCount: number;
  matchedCount: number;
  ocrFrameMs: number[];
  ocrConcurrency: number;
  ashedUploadTotalMs: number;
  ashedExtractTotalMs: number;
  totalRawOcrRows: number;
};

function resolveRosterConfig(input: ProcessRosterVideoParseInput): RosterOcrConfig {
  if (input.rosterConfig) return input.rosterConfig;
  return DEFAULT_ROSTER_OCR_CONFIG;
}

async function runRosterOcr(
  input: ProcessRosterVideoParseInput,
  hqAllianceId: string,
): Promise<{
  members: ExtractedRosterMember[];
  frameTimings: Array<{
    frameIndex: number;
    ms: number;
    uploadMs: number;
    extractMs: number;
    entryCount: number;
    error: string | null;
    rawResult?: unknown;
  }>;
  concurrency: number;
  rawPayloads: unknown[];
}> {
  if (input.engine === "mock") {
    const members = await mockOcrRosterFrames(
      input.scoreTargetId,
      input.frames.map((f) => ({ index: f.index })),
      { allianceId: hqAllianceId },
    );
    for (let i = 0; i < input.frames.length; i += 1) {
      await input.onOcrProgress?.(i + 1, input.frames.length);
    }
    return {
      members,
      frameTimings: input.frames.map((frame) => ({
        frameIndex: frame.index,
        ms: 1,
        uploadMs: 0,
        extractMs: 0,
        entryCount: members.filter((m) => m._sourceFrameIndex === frame.index).length,
        error: null,
      })),
      concurrency: 1,
      rawPayloads: [],
    };
  }

  if (input.engine === "native") {
    const config = resolveRosterConfig(input);
    const native = await ocrRosterNativeFrames(input.frames, {
      config,
      passKey: input.rosterPassKey ?? null,
      timer: input.timer,
      jobId: input.jobId,
      onProgress: input.onOcrProgress,
    });
    return {
      members: native.members,
      frameTimings: native.frameTimings.map((frame) => ({
        frameIndex: frame.frameIndex,
        ms: frame.ms,
        uploadMs: 0,
        extractMs: frame.ms,
        entryCount: frame.entryCount,
        error: frame.error,
        rawResult: null,
      })),
      concurrency: native.concurrency,
      rawPayloads: [],
    };
  }

  if (!input.connection) {
    throw new Error("Ashed connection required for roster OCR.");
  }

  const ashed = await ocrRosterAllFrames(
    input.connection,
    input.target,
    input.frames,
    { timer: input.timer, jobId: input.jobId, onProgress: input.onOcrProgress },
  );
  return {
    members: ashed.members,
    frameTimings: ashed.frameTimings,
    concurrency: ashed.concurrency,
    rawPayloads: ashed.rawPayloads,
  };
}

export async function processRosterVideoParse(
  input: ProcessRosterVideoParseInput,
): Promise<ProcessRosterVideoParseResult> {
  const db = getDb();
  const hqAllianceId = await input.timer.measureStep(
    "alliance.resolve_hq",
    () => resolveHqAllianceIdFromSession(input.sessionId),
  );

  const phaseKey =
    input.engine === "native"
      ? "tesseract.roster_ocr_total"
      : input.engine === "mock"
        ? "mock.roster_ocr_total"
        : "ashed.roster_ocr_total";

  const { members: rosterMembers, frameTimings, concurrency, rawPayloads } =
    await input.timer.measureStep(
      phaseKey,
      () => runRosterOcr(input, hqAllianceId),
      (result) => ({
        frameCount: input.frames.length,
        rowCount: result.members.length,
      }),
    );

  const ocrFrameMs = frameTimings.map((f) => f.ms);
  const ashedUploadTotalMs = frameTimings.reduce((sum, f) => sum + f.uploadMs, 0);
  const ashedExtractTotalMs = frameTimings.reduce(
    (sum, f) => sum + f.extractMs,
    0,
  );
  const totalRawOcrRows = frameTimings.reduce(
    (sum, f) => sum + (f.entryCount ?? 0),
    0,
  );

  await Promise.all(
    frameTimings.map((timing) =>
      db
        .update(schema.videoFrames)
        .set({
          uploadMs: timing.uploadMs,
          extractMs: timing.extractMs,
          ocrEntryCount: timing.entryCount,
          ocrError: timing.error,
          ocrRawJson: timing.rawResult ?? null,
        })
        .where(
          and(
            eq(schema.videoFrames.jobId, input.jobId),
            eq(schema.videoFrames.frameIndex, timing.frameIndex),
          ),
        ),
    ),
  );

  let hqMembers = await listAllianceMembers(hqAllianceId);
  const linkedAshedId = await getAshedAllianceIdIfLinked(hqAllianceId);
  if (hqMembers.length === 0 && linkedAshedId && input.connection) {
    await syncAllianceMembersFromAshed({
      hqAllianceId,
      ashedAllianceId: linkedAshedId,
      connection: input.connection,
    });
    hqMembers = await listAllianceMembers(hqAllianceId);
  }

  const members = hqMembers.map(allianceMemberRowToAshedMember);
  const allianceTag = await getSessionAllianceTag(input.sessionId);
  const memberIndex = members.length ? buildMemberIndex(members) : null;
  const parseSessionId = nanoid(16);

  await input.timer.measureStep("db.create_parse_session", async () => {
    await db.insert(schema.parseSessions).values({
      id: parseSessionId,
      jobId: input.jobId,
      sessionId: input.sessionId,
      scoreTarget: input.scoreTargetId,
      allianceId: hqAllianceId,
      rowCount: rosterMembers.length,
      matchedCount: 0,
      status: "open",
      rawExtractJson: rawPayloads,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }, { rowCount: rosterMembers.length });

  let matchedCount = 0;
  await input.timer.measureStep(
    "parse.match_and_persist_roster",
    async () => {
      for (const entry of rosterMembers) {
        const match = memberIndex
          ? matchMemberName(entry.currentName, memberIndex, { allianceTag })
          : {
              ocrName: entry.currentName,
              memberId: null,
              memberName: null,
              confidence: 0,
              matchMethod: "none" as const,
            };

        if (match.memberId) matchedCount++;

        await db.insert(schema.parsedRows).values({
          id: nanoid(16),
          parseSessionId,
          ocrName: entry.currentName,
          score: null,
          rank: null,
          rosterRankRaw: entry.rosterRankRaw,
          allianceRank: entry.allianceRank,
          allianceRankTitle: entry.allianceRankTitle,
          powerLevel: entry.powerLevel,
          memberLevel: entry.memberLevel,
          profession: entry.profession,
          memberId: match.memberId,
          memberName: match.memberName,
          matchConfidence: match.confidence,
          matchMethod: match.matchMethod,
          scoreConflict: 0,
          frameIndex: entry._sourceFrameIndex ?? null,
          deleted: 0,
          edited: 0,
          createdAt: input.now,
          updatedAt: input.now,
        });
      }
      return matchedCount;
    },
    (count) => ({ matchedCount: count, rowCount: rosterMembers.length }),
  );

  await input.timer.measureStep("db.update_parse_session", async () => {
    await db
      .update(schema.parseSessions)
      .set({
        matchedCount,
        rowCount: rosterMembers.length,
        updatedAt: new Date(),
      })
      .where(eq(schema.parseSessions.id, parseSessionId));
  });

  return {
    parseSessionId,
    hqAllianceId,
    rowCount: rosterMembers.length,
    matchedCount,
    ocrFrameMs,
    ocrConcurrency: concurrency,
    ashedUploadTotalMs,
    ashedExtractTotalMs,
    totalRawOcrRows,
  };
}
