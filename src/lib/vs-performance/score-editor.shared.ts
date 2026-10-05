import { parseVsScore } from "@/lib/vs-scores/evidence.shared";

export type VsScoreEditCell = {
  recordedDate: string;
  period: "daily" | "weekly";
  score: string | null;
  source: "hq" | "ashed" | "derived" | null;
  expectedHeadVersion: number | null;
  editable: boolean;
  canClear: boolean;
};

export type VsScoreDraftEdit = { operation: "set"; value: string } | { operation: "clear" };
export type VsScoreDraft = Map<string, VsScoreDraftEdit>;

export const scoreCellKey = (cell: Pick<VsScoreEditCell, "period" | "recordedDate">) => `${cell.period}:${cell.recordedDate}`;

export type VsScoreCommandChange = {
  recordedDate: string;
  period: "daily" | "weekly";
  expectedHeadVersion: number | null;
  operation: "set" | "clear";
  score?: string;
};

export function buildScoreChanges(draft: VsScoreDraft, cells: VsScoreEditCell[]): VsScoreCommandChange[] {
  const changes: VsScoreCommandChange[] = [];
  for (const cell of cells) {
    const edit = draft.get(scoreCellKey(cell));
    if (!edit) continue;
    if (edit.operation === "set") {
      changes.push({
        recordedDate: cell.recordedDate,
        period: cell.period,
        expectedHeadVersion: cell.expectedHeadVersion,
        operation: "set",
        score: edit.value,
      });
    } else {
      changes.push({
        recordedDate: cell.recordedDate,
        period: cell.period,
        expectedHeadVersion: cell.expectedHeadVersion,
        operation: "clear",
      });
    }
  }
  return changes;
}

export function validateScoreDraft(draft: VsScoreDraft): boolean {
  for (const edit of draft.values()) {
    if (edit.operation === "set") {
      try {
        parseVsScore(edit.value);
      } catch {
        return false;
      }
    }
  }
  return true;
}

function effectiveScore(cell: VsScoreEditCell, draft: VsScoreDraft): bigint | null | undefined {
  const edit = draft.get(scoreCellKey(cell));
  if (edit?.operation === "clear") return null;
  if (edit?.operation === "set") {
    try {
      return BigInt(parseVsScore(edit.value));
    } catch {
      return undefined;
    }
  }
  if (cell.score === null) return null;
  try {
    return BigInt(cell.score);
  } catch {
    return undefined;
  }
}

export function weeklyScoreMismatch(cells: VsScoreEditCell[], draft: VsScoreDraft): boolean {
  const daily = cells.filter((cell) => cell.period === "daily");
  const weeklyCell = cells.find((cell) => cell.period === "weekly");
  if (!weeklyCell) return false;
  const weekly = effectiveScore(weeklyCell, draft);
  if (weekly === null || weekly === undefined) return false;
  const values = daily.map((cell) => effectiveScore(cell, draft));
  const known = values.filter((value): value is bigint => typeof value === "bigint");
  if (values.some((value) => value === undefined)) return false;
  const sum = known.reduce((total, value) => total + value, BigInt(0));
  return (known.length === 6 && sum !== weekly) || sum > weekly;
}
