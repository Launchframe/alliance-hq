import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import {
  blankDesertStormMatchHeader,
  parseDesertStormMatchHeaderLines,
  type DesertStormMatchHeader,
} from "@/lib/video/desert-storm-match-header.shared";
import { isDesertStormVideoTarget } from "@/lib/video/score-targets";

const MIN_FRAME_BYTES = 1024;

export async function captureDesertStormMatchHeader(params: {
  scoreTargetId: string;
  firstFrame: Buffer | undefined;
  hqAllianceId: string | null;
  jobId?: string;
}): Promise<DesertStormMatchHeader> {
  if (!isDesertStormVideoTarget(params.scoreTargetId)) {
    return blankDesertStormMatchHeader();
  }
  if (!params.firstFrame || params.firstFrame.length < MIN_FRAME_BYTES) {
    return blankDesertStormMatchHeader();
  }
  if (!params.hqAllianceId) {
    return blankDesertStormMatchHeader();
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      name: schema.alliances.name,
      gameServerNumber: schema.alliances.gameServerNumber,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, params.hqAllianceId))
    .limit(1);

  if (!alliance?.name || !alliance.gameServerNumber) {
    return blankDesertStormMatchHeader();
  }

  const t0 = Date.now();
  try {
    const { buffer: processedBuffer } = await preprocessRosterImage(
      params.firstFrame,
    );
    const ocrLines = await runTesseract(processedBuffer);
    const textLines = ocrLines.map((line) => line.text);
    const parsed = parseDesertStormMatchHeaderLines(textLines, {
      name: alliance.name,
      gameServerNumber: alliance.gameServerNumber,
    });
    const diagnostics = buildOcrDiagnostics({
      source: "video_frame_native",
      durationMs: Date.now() - t0,
      rawLineCount: textLines.length,
      lines: textLines,
      parsedOk: parsed.filledFromOcr,
      parsedValue: parsed.theirsTotal,
      jobId: params.jobId,
      frameIndex: 0,
      scoreTarget: params.scoreTargetId,
    });
    logOcrDiagnostics(diagnostics);
    return parsed;
  } catch {
    logOcrDiagnostics(
      buildOcrDiagnostics({
        source: "video_frame_native",
        durationMs: Date.now() - t0,
        rawLineCount: 0,
        lines: [],
        parsedOk: false,
        jobId: params.jobId,
        frameIndex: 0,
        scoreTarget: params.scoreTargetId,
        error: "desert_storm_match_header_ocr_failed",
      }),
    );
    return blankDesertStormMatchHeader();
  }
}

export async function desertStormMatchRawExtractJson(params: {
  scoreTargetId: string;
  firstFrame: Buffer | undefined;
  hqAllianceId: string | null;
  jobId?: string;
}): Promise<Record<string, unknown> | undefined> {
  if (!isDesertStormVideoTarget(params.scoreTargetId)) {
    return undefined;
  }
  const desertStormMatch = await captureDesertStormMatchHeader(params);
  return { desertStormMatch };
}
