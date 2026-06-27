/** Podium rank column accepts a single digit 1–3 (VS / commendation targets). */
export function parsePodiumRankInput(raw: string): number | null {
  const digit = raw.replace(/\D/g, "").slice(0, 1);
  if (!digit) return null;
  const value = Number(digit);
  if (value < 1) return null;
  return Math.min(3, value);
}
