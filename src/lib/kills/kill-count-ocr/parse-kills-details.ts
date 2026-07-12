/**
 * Parse OCR text lines from a personal kill-count / defeat stats screenshot.
 * Prefers an explicit "total kills" label; otherwise the largest plausible total.
 */

import { validateKillsTotal } from "@/lib/kills/constants";

export type ParseKillsDetailsResult = {
  totalKills: number | null;
};

const TOTAL_KILLS_LABEL_RE =
  /\b(total\s*kills?|kills?\s*total|derrotas?\s*totais?|total\s*de\s*kills?)\b/i;
const KILLS_LABEL_RE = /\b(kills?|derrotas?)\b/i;

function parseIntegerToken(raw: string): number | null {
  const cleaned = raw.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const value = Number.parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : null;
}

function extractTrailingNumber(line: string): number | null {
  const parts = line.trim().split(/\s+/);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const value = parseIntegerToken(parts[i]!);
    if (value != null) return value;
  }
  return null;
}

function collectCandidateTotals(lines: string[]): number[] {
  const candidates: number[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const value = extractTrailingNumber(line);
    if (value == null || !validateKillsTotal(value)) continue;
    if (TOTAL_KILLS_LABEL_RE.test(line) || KILLS_LABEL_RE.test(line)) {
      candidates.push(value);
    }
  }
  return candidates;
}

export function parseKillsDetailsLines(lines: string[]): ParseKillsDetailsResult {
  const labeled = collectCandidateTotals(lines);
  if (labeled.length > 0) {
    // Prefer the largest labeled total (R5 totals dwarf rank-band counts).
    return { totalKills: Math.max(...labeled) };
  }

  const unlabeled: number[] = [];
  for (const rawLine of lines) {
    const value = extractTrailingNumber(rawLine);
    if (value != null && validateKillsTotal(value) && value >= 1_000) {
      unlabeled.push(value);
    }
  }
  if (unlabeled.length === 0) {
    return { totalKills: null };
  }
  return { totalKills: Math.max(...unlabeled) };
}
