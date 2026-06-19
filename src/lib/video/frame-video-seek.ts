export const ROW_VIDEO_PREVIEW_LEAD_SECONDS = 1;

export type FrameTimestampMap = Record<string, number>;

export function previewSeekSecondsForFrame(
  frameIndex: number | null | undefined,
  frameTimestamps: FrameTimestampMap,
  leadSeconds = ROW_VIDEO_PREVIEW_LEAD_SECONDS,
): number | null {
  if (frameIndex == null) return null;
  const timestamp = frameTimestamps[String(frameIndex)];
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - leadSeconds);
}
