export type FrameTimestampMap = Record<string, number>;

/** Typical mouse-wheel notch (~100 deltaY) advances ~1s — one leaderboard row at 1fps extraction. */
export const PREVIEW_WHEEL_SEEK_SECONDS_PER_100_DELTA = 1;

export function previewSeekSecondsForFrame(
  frameIndex: number | null | undefined,
  frameTimestamps: FrameTimestampMap,
): number | null {
  if (frameIndex == null) return null;
  const current = frameTimestamps[String(frameIndex)];
  const next = frameTimestamps[String(frameIndex + 1)];
  if (current == null || !Number.isFinite(current)) return null;
  if (next != null && Number.isFinite(next) && next > current) {
    return Math.max(0, (current + next) / 2);
  }
  return Math.max(0, current);
}

/**
 * Scroll-down (positive deltaY) seeks forward; scroll-up seeks backward.
 * Clamps to [0, duration] when duration is known.
 */
export function previewWheelSeekSeconds(
  currentSeconds: number,
  deltaY: number,
  durationSeconds: number | null | undefined,
): number {
  if (deltaY === 0 || !Number.isFinite(currentSeconds)) return currentSeconds;
  const step =
    (deltaY / 100) * PREVIEW_WHEEL_SEEK_SECONDS_PER_100_DELTA;
  const upper =
    durationSeconds != null &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
      ? durationSeconds
      : Math.max(0, currentSeconds + Math.abs(step));
  return Math.max(0, Math.min(upper, currentSeconds + step));
}
