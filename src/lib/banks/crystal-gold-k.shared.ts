/**
 * CrystalGold K-unit display / entry for City List import review.
 * Storage and APIs stay in absolute CrystalGold; the review UI shows/edits K.
 */

/** Format an absolute CrystalGold amount as in-game K text, e.g. 660000 → "660.00K". */
export function formatCrystalGoldAsK(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "";
  const k = value / 1_000;
  return `${k.toFixed(2)}K`;
}

/**
 * Parse a K-unit amount field into absolute CrystalGold.
 * Accepts "660", "660.00", "660.00K", "660.00k". Returns null for empty/invalid.
 * M/B suffixes are rejected on this surface (K-only entry).
 */
export function parseCrystalGoldKInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[mb]/i.test(trimmed.replace(/k$/i, ""))) return null;

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*[kK]?$/);
  if (!match) return null;
  const k = Number(match[1]);
  if (!Number.isFinite(k) || k < 0) return null;
  return Math.round(k * 1_000);
}
