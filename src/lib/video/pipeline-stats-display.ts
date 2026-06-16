import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";

export type PipelineStatsSection = {
  id: "extract" | "alliance" | "ocr" | "parse";
  phaseKeys: string[];
  wallMs: number;
};

const EXTRACT_PHASES = [
  "storage.load_video",
  "storage.write_temp_video",
  "ffmpeg.extract",
  "storage.delete_temp_video",
  "storage.put_frame",
] as const;

const ALLIANCE_PHASES = ["alliance.resolve", "alliance.load_tag"] as const;

const OCR_WALL_PHASES = ["ashed.ocr_total", "ashed.batch_complete"] as const;

const OCR_SUM_PHASES = [
  "ashed.upload",
  "ashed.extract",
  "ashed.frame",
  "ashed.frame_wall",
] as const;

const PARSE_PHASES = [
  "parse.collapse_rows",
  "ashed.list_members",
  "parse.match_and_persist",
  "db.create_parse_session",
  "db.update_parse_session",
] as const;

export function formatPipelineDuration(
  ms: number | null | undefined,
): string {
  if (ms == null || !Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function sumPhaseMs(
  phases: Record<string, number>,
  keys: readonly string[],
): number {
  return keys.reduce((sum, key) => sum + (phases[key] ?? 0), 0);
}

export function firstPhaseMs(
  phases: Record<string, number>,
  keys: readonly string[],
): number {
  for (const key of keys) {
    const ms = phases[key];
    if (ms != null && ms > 0) {
      return ms;
    }
  }
  return 0;
}

export function isVideoProcessTimings(
  raw: unknown,
): raw is VideoProcessTimings {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.totalMs === "number" &&
    obj.phases != null &&
    typeof obj.phases === "object"
  );
}

export function buildPipelineStatsSections(
  timings: VideoProcessTimings,
): PipelineStatsSection[] {
  const phases = timings.phases;

  return [
    {
      id: "extract",
      phaseKeys: [...EXTRACT_PHASES],
      wallMs: sumPhaseMs(phases, EXTRACT_PHASES),
    },
    {
      id: "alliance",
      phaseKeys: [...ALLIANCE_PHASES],
      wallMs: sumPhaseMs(phases, ALLIANCE_PHASES),
    },
    {
      id: "ocr",
      phaseKeys: [...OCR_WALL_PHASES, ...OCR_SUM_PHASES],
      wallMs: firstPhaseMs(phases, OCR_WALL_PHASES),
    },
    {
      id: "parse",
      phaseKeys: [...PARSE_PHASES],
      wallMs: sumPhaseMs(phases, PARSE_PHASES),
    },
  ];
}

export function listPipelinePhaseBars(
  phases: Record<string, number>,
): Array<[string, number]> {
  return Object.entries(phases)
    .filter(([, ms]) => ms > 0)
    .sort(([, a], [, b]) => b - a);
}

export function ocrSummedUploadMs(phases: Record<string, number>): number {
  return phases["ashed.upload"] ?? 0;
}

export function ocrSummedExtractMs(phases: Record<string, number>): number {
  return phases["ashed.extract"] ?? 0;
}

export function ocrWallMs(phases: Record<string, number>): number {
  return firstPhaseMs(phases, OCR_WALL_PHASES);
}
