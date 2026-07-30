import type { ScreenshotOcrBboxOverlay } from "@/lib/ocr/screenshot-ocr-geometry.shared";
import type { ScreenshotOcrFailureCode } from "@/lib/ocr/screenshot-ocr-quality.shared";

export const VIDEO_FRAME_HQ_GEOMETRY_KEY = "_hq";

export type VideoFrameHqGeometryKind =
  | "roster"
  | "deposit_slip"
  | "thp_modal";

export type VideoFrameHqGeometry = {
  kind: VideoFrameHqGeometryKind;
  sourceWidth: number;
  sourceHeight: number;
  parsedOk: boolean;
  entryCount: number;
  rawLineCount: number;
  durationMs: number;
  lowQuality: boolean;
  lowQualityReason?: string;
  failureCodes: ScreenshotOcrFailureCode[];
  bboxOverlays?: ScreenshotOcrBboxOverlay[];
};

export type VideoJobHqGeometrySummary = {
  frameCount: number;
  framesWithGeometry: number;
  worstEntryCount: number;
  dominantFailureCode: ScreenshotOcrFailureCode | null;
  lowQualityFrameCount: number;
  frames: Array<{
    frameIndex: number;
    kind: VideoFrameHqGeometryKind;
    parsedOk: boolean;
    entryCount: number;
    failureCodes: ScreenshotOcrFailureCode[];
    lowQuality: boolean;
  }>;
};

export function attachHqGeometryToOcrRawJson(
  payload: unknown,
  geometry: VideoFrameHqGeometry,
): Record<string, unknown> {
  const base =
    payload != null && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : payload == null
        ? {}
        : { data: payload };
  return {
    ...base,
    [VIDEO_FRAME_HQ_GEOMETRY_KEY]: geometry,
  };
}

export function readHqGeometryFromOcrRawJson(
  ocrRawJson: unknown,
): VideoFrameHqGeometry | null {
  if (!ocrRawJson || typeof ocrRawJson !== "object" || Array.isArray(ocrRawJson)) {
    return null;
  }
  const hq = (ocrRawJson as Record<string, unknown>)[VIDEO_FRAME_HQ_GEOMETRY_KEY];
  if (!hq || typeof hq !== "object" || Array.isArray(hq)) {
    return null;
  }
  const row = hq as Partial<VideoFrameHqGeometry>;
  if (
    typeof row.kind !== "string" ||
    typeof row.parsedOk !== "boolean" ||
    typeof row.entryCount !== "number"
  ) {
    return null;
  }
  return {
    kind: row.kind,
    sourceWidth: row.sourceWidth ?? 0,
    sourceHeight: row.sourceHeight ?? 0,
    parsedOk: row.parsedOk,
    entryCount: row.entryCount,
    rawLineCount: row.rawLineCount ?? 0,
    durationMs: row.durationMs ?? 0,
    lowQuality: row.lowQuality ?? false,
    lowQualityReason: row.lowQualityReason,
    failureCodes: Array.isArray(row.failureCodes)
      ? (row.failureCodes as ScreenshotOcrFailureCode[])
      : [],
    bboxOverlays: Array.isArray(row.bboxOverlays)
      ? (row.bboxOverlays as ScreenshotOcrBboxOverlay[])
      : undefined,
  };
}

export function buildRosterFrameHqGeometry(input: {
  sourceWidth: number;
  sourceHeight: number;
  entryCount: number;
  rawLineCount: number;
  durationMs: number;
  lowQuality?: boolean;
  lowQualityReason?: string;
}): VideoFrameHqGeometry {
  const failureCodes: ScreenshotOcrFailureCode[] = [];
  if (input.entryCount === 0) {
    failureCodes.push("too_few_ocr_lines");
  }
  if (input.lowQuality) {
    failureCodes.push("crop_misaligned");
  }
  return {
    kind: "roster",
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    parsedOk: input.entryCount > 0 && !input.lowQuality,
    entryCount: input.entryCount,
    rawLineCount: input.rawLineCount,
    durationMs: input.durationMs,
    lowQuality: input.lowQuality ?? false,
    lowQualityReason: input.lowQualityReason,
    failureCodes,
  };
}

export function buildDepositSlipFrameHqGeometry(input: {
  sourceWidth: number;
  sourceHeight: number;
  slipCount: number;
  rawLineCount: number;
  durationMs: number;
}): VideoFrameHqGeometry {
  const failureCodes: ScreenshotOcrFailureCode[] = [];
  if (input.slipCount === 0) {
    failureCodes.push("too_few_ocr_lines");
  }
  return {
    kind: "deposit_slip",
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    parsedOk: input.slipCount > 0,
    entryCount: input.slipCount,
    rawLineCount: input.rawLineCount,
    durationMs: input.durationMs,
    lowQuality: input.slipCount === 0,
    failureCodes,
  };
}

export function aggregateVideoJobHqGeometry(
  frames: Array<{ frameIndex: number; hq: VideoFrameHqGeometry | null }>,
): VideoJobHqGeometrySummary {
  const withGeometry = frames.filter(
    (frame): frame is { frameIndex: number; hq: VideoFrameHqGeometry } =>
      frame.hq != null,
  );

  const failureCounts = new Map<ScreenshotOcrFailureCode, number>();
  let worstEntryCount = Number.POSITIVE_INFINITY;
  let lowQualityFrameCount = 0;

  for (const frame of withGeometry) {
    worstEntryCount = Math.min(worstEntryCount, frame.hq.entryCount);
    if (frame.hq.lowQuality) lowQualityFrameCount += 1;
    for (const code of frame.hq.failureCodes) {
      failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
    }
  }

  let dominantFailureCode: ScreenshotOcrFailureCode | null = null;
  let dominantCount = 0;
  for (const [code, count] of failureCounts) {
    if (count > dominantCount) {
      dominantFailureCode = code;
      dominantCount = count;
    }
  }

  return {
    frameCount: frames.length,
    framesWithGeometry: withGeometry.length,
    worstEntryCount: Number.isFinite(worstEntryCount) ? worstEntryCount : 0,
    dominantFailureCode,
    lowQualityFrameCount,
    frames: withGeometry.map((frame) => ({
      frameIndex: frame.frameIndex,
      kind: frame.hq.kind,
      parsedOk: frame.hq.parsedOk,
      entryCount: frame.hq.entryCount,
      failureCodes: frame.hq.failureCodes,
      lowQuality: frame.hq.lowQuality,
    })),
  };
}
