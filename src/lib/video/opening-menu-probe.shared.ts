/** Stop probing once the seek is past the first second of the recording. */
export const OPENING_MENU_PROBE_MAX_SECONDS = 1;

/**
 * Times to inspect for the leaderboard menu, starting at the first decoded
 * frame. Later probes double the frame step so a long run of junk at the
 * start does not OCR every frame.
 */
export function openingMenuProbeTimestamps(
  fps: number | null,
  maxSeconds = OPENING_MENU_PROBE_MAX_SECONDS,
): number[] {
  const frameSeconds = fps != null && fps > 0 ? 1 / fps : 1 / 30;
  const stamps = [0];
  let stepFrames = 1;
  let frameIndex = 0;
  while (stamps.length < 8) {
    frameIndex += stepFrames;
    const timestamp = frameIndex * frameSeconds;
    if (timestamp > maxSeconds) break;
    stamps.push(timestamp);
    stepFrames *= 2;
  }
  return stamps;
}

/** True when in-house OCR of the top of a frame sees the VS rank menu. */
export function textShowsLeaderboardMenu(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bdaily rank\b/.test(normalized) || /\bweekly rank\b/.test(normalized)) {
    return true;
  }
  const hasRanking = /\branking\b/.test(normalized);
  const hasCommander = /\bcommander\b/.test(normalized);
  const hasPoints = /\bpoints\b/.test(normalized);
  return hasRanking && hasCommander && hasPoints;
}
