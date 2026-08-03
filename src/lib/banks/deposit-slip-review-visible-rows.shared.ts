/**
 * Visible row order for deposit-slip review: broader text filter than the
 * parent name/member filter, plus table sort. Shared so Follow-me and the
 * table stay on the same row set.
 */

export type DepositSlipVisibleSortKey = "commander" | "depositAt";

export type DepositSlipVisibleRowFields = {
  id: string;
  ocrName: string;
  score: string | null;
  /** ISO deposit timestamp when present (display only; sort uses frame order). */
  powerLevel: string | null;
  profession: string | null;
  allianceRankTitle: string | null;
  frameIndex?: number | null;
};

export function filterAndSortDepositSlipReviewRows<
  T extends DepositSlipVisibleRowFields,
>(
  rows: readonly T[],
  options: {
    filterQuery: string;
    sortKey: DepositSlipVisibleSortKey;
  },
): T[] {
  const q = options.filterQuery.trim().toLowerCase();
  let list: T[] = [...rows];
  if (q) {
    list = list.filter((row) => {
      const haystack = [
        row.ocrName,
        row.allianceRankTitle ?? "",
        row.score ?? "",
        row.profession ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }
  return list.sort((a, b) => {
    if (options.sortKey === "commander") {
      return a.ocrName.localeCompare(b.ocrName, undefined, {
        sensitivity: "base",
      });
    }
    const aFrame = a.frameIndex ?? Number.MAX_SAFE_INTEGER;
    const bFrame = b.frameIndex ?? Number.MAX_SAFE_INTEGER;
    if (aFrame !== bFrame) return aFrame - bFrame;
    return a.id.localeCompare(b.id);
  });
}
