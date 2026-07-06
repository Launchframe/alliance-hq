export type VideoJobInspectHintCode =
  | "stuck_parsing_no_ocr"
  | "stuck_parsing_native_ocr"
  | "queued_stale"
  | "failed_with_message"
  | "healthy_review";

export type VideoJobInspectHintSeverity = "info" | "warning" | "error";

export type VideoJobInspectHint = {
  code: VideoJobInspectHintCode;
  severity: VideoJobInspectHintSeverity;
  /** Optional interpolation values for i18n (e.g. error message). */
  values?: Record<string, string | number>;
};

export type VideoJobInspectFrameRow = {
  frameIndex: number;
  ocrEntryCount: number | null;
  ocrError: string | null;
  uploadMs: number | null;
  extractMs: number | null;
  hasRaw: boolean;
};

export type VideoJobInspectReport = {
  job: {
    id: string;
    status: string;
    scoreTarget: string | null;
    fileName: string | null;
    fileSizeBytes: number | null;
    frameCount: number | null;
    uploadedFrameCount: number | null;
    errorMessage: string | null;
    sessionId: string;
    processingSessionId: string | null;
    allianceId: string | null;
    passKey: string | null;
    passRole: string | null;
    approvedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  alliance: {
    videoHqOcrOnly: number;
    tag: string | null;
    name: string | null;
    operatingMode: string;
  } | null;
  ocrEngineHint: string;
  timingsSummary: {
    frameCount: unknown;
    rowCount: unknown;
    matchedCount: unknown;
    totalRawOcrRows: unknown;
    totalMs: unknown;
    phases: unknown;
  } | null;
  uploaderVsProcessorSameSession: boolean;
  frameSummary: {
    count: number;
    totalOcrEntries: number;
    framesWithErrors: number;
    frames: VideoJobInspectFrameRow[];
  };
  firstFrameRawSample: unknown;
  parseSessions: Array<{
    id: string;
    rowCount: number | null;
    matchedCount: number | null;
    status: string;
  }>;
  parsedRowsInDb: number;
  hints: VideoJobInspectHint[];
};

/** Summarize Ashed OCR raw JSON without dumping the full payload. */
export function summarizeOcrRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw ?? null;
  const obj = raw as Record<string, unknown>;
  const unwrapped =
    obj.output && typeof obj.output === "object"
      ? (obj.output as Record<string, unknown>)
      : obj.data && typeof obj.data === "object"
        ? (obj.data as Record<string, unknown>)
        : obj;
  const members =
    unwrapped.members ?? unwrapped.entries ?? unwrapped.players;
  return {
    topLevelKeys: Object.keys(obj),
    unwrappedKeys: Object.keys(unwrapped),
    membersIsArray: Array.isArray(members),
    membersLength: Array.isArray(members) ? members.length : null,
    firstMemberKeys:
      Array.isArray(members) && members[0] && typeof members[0] === "object"
        ? Object.keys(members[0] as object)
        : null,
  };
}

export function resolveVideoJobOcrEngineHint(
  videoHqOcrOnly: number | boolean | null | undefined,
): string {
  return videoHqOcrOnly ? "native (video_hq_ocr_only)" : "ashed (default prod)";
}

const QUEUED_STALE_MS = 5 * 60 * 1000;

type HintInput = {
  status: string;
  errorMessage: string | null;
  frameCount: number;
  totalOcrEntries: number;
  timingsSummary: VideoJobInspectReport["timingsSummary"];
  ocrEngineHint: string;
  parsedRowsInDb: number;
  approvedAt: string | null;
  updatedAt: string;
  nowMs?: number;
};

/** Heuristic ops hints — mirrors what we look for in the CLI inspect script. */
export function buildVideoJobInspectHints(input: HintInput): VideoJobInspectHint[] {
  const hints: VideoJobInspectHint[] = [];
  const nowMs = input.nowMs ?? Date.now();

  const stuckParsing =
    input.status === "parsing" &&
    input.frameCount > 0 &&
    input.totalOcrEntries === 0 &&
    input.timingsSummary == null;

  if (stuckParsing) {
    hints.push({
      code: "stuck_parsing_no_ocr",
      severity: "warning",
    });
    if (input.ocrEngineHint.includes("native")) {
      hints.push({
        code: "stuck_parsing_native_ocr",
        severity: "warning",
      });
    }
  }

  if (input.status === "queued" && input.approvedAt) {
    const approvedMs = Date.parse(input.approvedAt);
    const updatedMs = Date.parse(input.updatedAt);
    if (
      Number.isFinite(approvedMs) &&
      Number.isFinite(updatedMs) &&
      nowMs - Math.max(approvedMs, updatedMs) > QUEUED_STALE_MS
    ) {
      hints.push({ code: "queued_stale", severity: "warning" });
    }
  }

  if (input.status === "failed" && input.errorMessage) {
    hints.push({
      code: "failed_with_message",
      severity: "error",
      values: { message: input.errorMessage },
    });
  }

  if (input.status === "review" && input.parsedRowsInDb > 0) {
    hints.push({ code: "healthy_review", severity: "info" });
  }

  return hints;
}
