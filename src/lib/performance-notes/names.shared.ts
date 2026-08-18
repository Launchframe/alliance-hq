export const PERFORMANCE_NOTE_AUTO_MATCH_MIN = 0.85;

export function splitCommanderNames(raw: string): string[] {
  return raw
    .split(/(?:,|\band\b|\.)/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}
