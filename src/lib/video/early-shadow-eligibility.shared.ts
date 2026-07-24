/**
 * VS early-shadow heuristics: expected leaderboard rows and undersample triggers.
 */

export const VS_EARLY_SHADOW_MIN_ROSTER = 20;
export const VS_MAX_VISIBLE_ROWS_PER_FRAME = 6;
export const VS_DENSE_FRAME_UNDERSAMPLE_RATIO = 0.5;
export const VS_SHADOW_WITHHOLD_DEFAULT_MS = 5 * 60 * 1000;

/** Job statuses after which a shadow pass can no longer change withhold state. */
export const VIDEO_SHADOW_PASS_TERMINAL_STATUSES = [
  "review",
  "complete",
  "submitting",
  "failed",
  "discarded",
] as const;

export function isShadowPassTerminalStatus(status: string): boolean {
  return (VIDEO_SHADOW_PASS_TERMINAL_STATUSES as readonly string[]).includes(
    status,
  );
}

export function expectedVsRowCount(params: {
  rosterSize: number | null | undefined;
  surveyRowCountEstimate: number | null | undefined;
}): number | null {
  const survey = params.surveyRowCountEstimate;
  if (
    survey != null &&
    Number.isFinite(survey) &&
    survey > 0
  ) {
    return Math.floor(survey);
  }
  const roster = params.rosterSize;
  if (roster == null || !Number.isFinite(roster) || roster < VS_EARLY_SHADOW_MIN_ROSTER) {
    return null;
  }
  return Math.floor(roster * 0.9);
}

export function shouldEnqueueEarlyExtractionShadow(params: {
  scoreTargetId: string | null | undefined;
  passRole: string | null | undefined;
  frameCount: number;
  denseFrameCount: number | null | undefined;
  expectedRows: number | null;
}): boolean {
  if (params.scoreTargetId !== "vs-performance") return false;
  if (params.passRole !== "primary") return false;
  const expected = params.expectedRows;
  if (expected == null || expected < VS_EARLY_SHADOW_MIN_ROSTER) return false;

  const frames = Math.max(0, Math.floor(params.frameCount));
  if (frames * VS_MAX_VISIBLE_ROWS_PER_FRAME < expected) {
    return true;
  }

  const dense = params.denseFrameCount;
  if (
    dense != null &&
    Number.isFinite(dense) &&
    dense > 0 &&
    frames < Math.ceil(dense * VS_DENSE_FRAME_UNDERSAMPLE_RATIO)
  ) {
    return true;
  }

  return false;
}

export function isPrimaryParseInadequate(params: {
  /** Non-deleted parsed row count (not deduped unique names). */
  activeRowCount: number;
  expectedRows: number | null;
  forceInadequate?: boolean;
}): boolean {
  if (params.forceInadequate) return true;
  if (params.expectedRows == null) return false;
  return params.activeRowCount < params.expectedRows;
}
