import type { DepositStatus } from "@/lib/banks/types.shared";

/**
 * Minimal shape needed to pair a terminal-state (looted/matured) deposit
 * slip row with the "locked" row that preceded it in-game, for display
 * grouping only. This never changes underlying data — it's a best-effort
 * visual pairing so reviewers can see the full lifecycle of a deposit at a
 * glance.
 */
export type DepositSlipPairableRow = {
  id: string;
  ocrName: string;
  score: string | null; // amount
  memberLevel: number | null; // termDays
  allianceRankTitle: string | null; // alliance tag
  profession: string | null; // status
  frameIndex?: number | null;
};

export type DepositSlipRowPair<T extends DepositSlipPairableRow> = {
  locked: T;
  terminal: T;
};

function normalizedStatus(row: DepositSlipPairableRow): DepositStatus {
  return row.profession === "matured" || row.profession === "looted"
    ? row.profession
    : "locked";
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function tagsCompatible(a: string | null, b: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function amountsCompatible(a: string | null, b: string | null): boolean {
  const an = a?.trim() ? Number(a) : null;
  const bn = b?.trim() ? Number(b) : null;
  if (an == null || bn == null || !Number.isFinite(an) || !Number.isFinite(bn)) {
    return true;
  }
  return an === bn;
}

function termsCompatible(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  return a === b;
}

/**
 * The in-game deposit slip history is newest-first, so a terminal-state
 * (looted/matured) entry is chronologically newer than — and therefore
 * observed by the OCR parser in an earlier frame than — the "locked" entry
 * for the same deposit. When both rows have a frame index, require that
 * ordering; otherwise don't gate on it.
 */
function frameOrderCompatible(
  terminal: DepositSlipPairableRow,
  locked: DepositSlipPairableRow,
): boolean {
  if (terminal.frameIndex == null || locked.frameIndex == null) return true;
  return terminal.frameIndex < locked.frameIndex;
}

function frameGap(
  terminal: DepositSlipPairableRow,
  locked: DepositSlipPairableRow,
): number {
  if (terminal.frameIndex == null || locked.frameIndex == null) {
    return Number.POSITIVE_INFINITY;
  }
  return locked.frameIndex - terminal.frameIndex;
}

/**
 * Best-effort pairing of terminal-state rows with the locked row that
 * preceded them, for display grouping. Matching is deliberately
 * conservative (name + compatible tag/amount/term/frame order) since a
 * missed pairing just renders as two ungrouped rows, but a wrong pairing
 * would be actively misleading.
 */
export function pairDepositSlipTerminalRows<T extends DepositSlipPairableRow>(
  rows: readonly T[],
): {
  pairs: DepositSlipRowPair<T>[];
  pairedRowIds: Set<string>;
} {
  const lockedRows = rows.filter((row) => normalizedStatus(row) === "locked");
  const terminalRows = rows.filter((row) => normalizedStatus(row) !== "locked");

  const usedLockedIds = new Set<string>();
  const pairs: DepositSlipRowPair<T>[] = [];

  for (const terminal of terminalRows) {
    const terminalName = normalizedName(terminal.ocrName);
    const candidates = lockedRows.filter(
      (locked) =>
        !usedLockedIds.has(locked.id) &&
        normalizedName(locked.ocrName) === terminalName &&
        terminalName.length > 0 &&
        tagsCompatible(terminal.allianceRankTitle, locked.allianceRankTitle) &&
        amountsCompatible(terminal.score, locked.score) &&
        termsCompatible(terminal.memberLevel, locked.memberLevel) &&
        frameOrderCompatible(terminal, locked),
    );
    if (candidates.length === 0) continue;

    const best = candidates.reduce((closest, candidate) =>
      frameGap(terminal, candidate) < frameGap(terminal, closest)
        ? candidate
        : closest,
    );
    usedLockedIds.add(best.id);
    pairs.push({ locked: best, terminal });
  }

  const pairedRowIds = new Set<string>();
  for (const pair of pairs) {
    pairedRowIds.add(pair.locked.id);
    pairedRowIds.add(pair.terminal.id);
  }

  return { pairs, pairedRowIds };
}
