export const VIDEO_REVIEW_DRAFT_STORAGE_KEY_PREFIX = "hq-video-review-draft-v1";

export type VideoReviewDraftRow = {
  id: string;
  ocrName: string;
  score: string | null;
  rank: number | null;
  rosterRankRaw?: string | null;
  allianceRank?: number | null;
  allianceRankTitle?: string | null;
  powerLevel?: string | null;
  heroPowerM?: number | null;
  memberLevel?: number | null;
  profession?: string | null;
  edited?: number;
  frameIndex?: number | null;
  memberId: string | null;
  memberName: string | null;
  matchConfidence: number | null;
  matchMethod: string | null;
  scoreConflict: number;
  deleted: number;
  manuallyAdded?: number;
};

export type VideoReviewDraftForm = {
  eventId: string;
  hqEventId: string;
  boardKey: string;
  team: "A" | "B";
  recordedDate: string;
  bankId?: string;
  vsPeriod?: "daily" | "weekly";
};

export type VideoReviewDraftV1 = VideoReviewDraftForm & {
  version: 1;
  jobId: string;
  viewMode: "review" | "event";
  savedAt: string;
  rowSignature: string;
  rows: VideoReviewDraftRow[];
};

export function videoReviewDraftStorageKey(
  jobId: string,
  viewMode: "review" | "event",
): string {
  return `${VIDEO_REVIEW_DRAFT_STORAGE_KEY_PREFIX}:${jobId}:${viewMode}`;
}

export function computeVideoReviewRowSignature(
  rows: Array<{ id: string }>,
): string {
  return rows
    .map((row) => row.id)
    .sort()
    .join(",");
}

export function buildVideoReviewDraft(input: {
  jobId: string;
  viewMode: "review" | "event";
  rows: VideoReviewDraftRow[];
  form: VideoReviewDraftForm;
  savedAt?: string;
}): VideoReviewDraftV1 {
  return {
    version: 1,
    jobId: input.jobId,
    viewMode: input.viewMode,
    savedAt: input.savedAt ?? new Date().toISOString(),
    rowSignature: computeVideoReviewRowSignature(input.rows),
    rows: input.rows,
    ...input.form,
  };
}

function isDraftRow(value: unknown): value is VideoReviewDraftRow {
  if (!value || typeof value !== "object") return false;
  const row = value as VideoReviewDraftRow;
  return typeof row.id === "string" && typeof row.ocrName === "string";
}

export function parseVideoReviewDraft(raw: string): VideoReviewDraftV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const draft = parsed as VideoReviewDraftV1;
    if (draft.version !== 1) return null;
    if (typeof draft.jobId !== "string") return null;
    if (draft.viewMode !== "review" && draft.viewMode !== "event") return null;
    if (typeof draft.rowSignature !== "string") return null;
    if (!Array.isArray(draft.rows) || !draft.rows.every(isDraftRow)) return null;
    if (typeof draft.eventId !== "string") return null;
    if (typeof draft.hqEventId !== "string") return null;
    if (typeof draft.boardKey !== "string") return null;
    if (draft.team !== "A" && draft.team !== "B") return null;
    if (typeof draft.recordedDate !== "string") return null;
    if (draft.bankId != null && typeof draft.bankId !== "string") return null;
    if (
      draft.vsPeriod != null &&
      draft.vsPeriod !== "daily" &&
      draft.vsPeriod !== "weekly"
    ) {
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function isVideoReviewDraftApplicable(
  draft: VideoReviewDraftV1,
  jobId: string,
  viewMode: "review" | "event",
  rowSignature: string,
): boolean {
  return (
    draft.jobId === jobId &&
    draft.viewMode === viewMode &&
    draft.rowSignature === rowSignature &&
    draft.rowSignature.length > 0
  );
}

export function shouldAutosaveVideoReviewDraft(input: {
  enabled: boolean;
  autosaveReady: boolean;
  dirtyVersion: number;
  baselineDirtyVersion: number;
  rowCount: number;
}): boolean {
  return (
    input.enabled &&
    input.autosaveReady &&
    input.rowCount > 0 &&
    input.dirtyVersion > input.baselineDirtyVersion
  );
}

/** Apply per-row draft edits onto the server row list (same row ids). */
export function mergeVideoReviewDraftRows<T extends VideoReviewDraftRow>(
  serverRows: T[],
  draftRows: VideoReviewDraftRow[],
): T[] {
  const draftById = new Map(draftRows.map((row) => [row.id, row]));
  return serverRows.map((serverRow) => {
    const draftRow = draftById.get(serverRow.id);
    return draftRow ? { ...serverRow, ...draftRow } : serverRow;
  });
}

export function readVideoReviewDraftFromStorage(
  jobId: string,
  viewMode: "review" | "event",
): VideoReviewDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      videoReviewDraftStorageKey(jobId, viewMode),
    );
    if (!raw) return null;
    return parseVideoReviewDraft(raw);
  } catch {
    return null;
  }
}

export function writeVideoReviewDraftToStorage(draft: VideoReviewDraftV1): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      videoReviewDraftStorageKey(draft.jobId, draft.viewMode),
      JSON.stringify(draft),
    );
  } catch {
    // quota or private mode — ignore
  }
}

export function clearVideoReviewDraftFromStorage(
  jobId: string,
  viewMode: "review" | "event",
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(videoReviewDraftStorageKey(jobId, viewMode));
  } catch {
    // ignore
  }
}

export type VideoReviewDraftRestoreResult<T extends VideoReviewDraftRow> = {
  rows: T[];
  form: VideoReviewDraftForm | null;
  restored: boolean;
  savedAt: string | null;
};

export function restoreVideoReviewDraftIfPresent<T extends VideoReviewDraftRow>(
  jobId: string,
  viewMode: "review" | "event",
  serverRows: T[],
): VideoReviewDraftRestoreResult<T> {
  const signature = computeVideoReviewRowSignature(serverRows);
  const draft = readVideoReviewDraftFromStorage(jobId, viewMode);
  if (
    !draft ||
    !isVideoReviewDraftApplicable(draft, jobId, viewMode, signature)
  ) {
    return { rows: serverRows, form: null, restored: false, savedAt: null };
  }

  return {
    rows: mergeVideoReviewDraftRows(serverRows, draft.rows),
    form: {
      eventId: draft.eventId,
      hqEventId: draft.hqEventId,
      boardKey: draft.boardKey,
      team: draft.team,
      recordedDate: draft.recordedDate,
      bankId: draft.bankId ?? "",
      vsPeriod: draft.vsPeriod,
    },
    restored: true,
    savedAt: draft.savedAt ?? null,
  };
}
