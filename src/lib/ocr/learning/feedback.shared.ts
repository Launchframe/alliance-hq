import { normalizeOcrInteger } from "../benchmark/metrics.shared";
import { OcrLearningError, ocrIdSchema } from "../benchmark/types.shared";

export type ReviewRowInput = { id: string; [key: string]: unknown };
export type ReviewRowSnapshot = {
  id: string;
  observedName: string | null;
  score: string | null;
  memberId: string | null;
  memberName: string | null;
  rank: number | null;
  evidenceFrameIndex: number | null;
  manuallyAdded: boolean;
  deleted: boolean;
};

function text(value: unknown, max = 160): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value).slice(0, max);
}
function flag(value: unknown): boolean { return value === true || value === 1; }

export function snapshotReviewRows(rows: readonly ReviewRowInput[]): ReviewRowSnapshot[] {
  if (rows.length > 2000 || new Set(rows.map((row) => row.id)).size !== rows.length) throw new OcrLearningError("invalid_rows");
  return rows.map((row) => {
    if (!ocrIdSchema.safeParse(row.id).success) throw new OcrLearningError("invalid_rows");
    const manuallyAdded = flag(row.manuallyAdded);
    return {
      id: row.id, observedName: text(row.ocrName), score: text(row.score, 128), memberId: text(row.memberId, 128), memberName: text(row.memberName),
      rank: typeof row.rank === "number" && Number.isSafeInteger(row.rank) && row.rank > 0 ? row.rank : null,
      evidenceFrameIndex: !manuallyAdded && typeof row.frameIndex === "number" && Number.isSafeInteger(row.frameIndex) && row.frameIndex >= 0 ? row.frameIndex : null,
      manuallyAdded, deleted: flag(row.deleted),
    };
  });
}

export function buildFeedbackPayload(currentRows: readonly ReviewRowInput[], submittedRows: readonly ReviewRowInput[], automaticDeletedIds: readonly string[], initialRows?: readonly ReviewRowSnapshot[], humanDeletesKnown = false) {
  const previous = snapshotReviewRows(currentRows);
  const byId = new Map(previous.map((row) => [row.id, row]));
  if (submittedRows.length > 2000 || new Set(submittedRows.map((row) => row.id)).size !== submittedRows.length || submittedRows.some((row) => !byId.has(row.id)) || automaticDeletedIds.some((id) => !byId.has(id))) throw new OcrLearningError("invalid_rows");
  const baseline = new Map((initialRows ?? previous).map((row) => [row.id, row]));
  const automatic = new Set(automaticDeletedIds);
  const rows = submittedRows.map((row) => {
    const old = byId.get(row.id)!;
    const before = baseline.get(row.id) ?? null;
    const after = {
      score: row.score === undefined ? old.score : text(row.score, 128),
      memberId: row.memberId === undefined ? old.memberId : text(row.memberId, 128),
      memberName: row.memberName === undefined ? old.memberName : text(row.memberName),
      rank: row.rank === undefined ? old.rank : typeof row.rank === "number" && Number.isSafeInteger(row.rank) && row.rank > 0 ? row.rank : null,
      deleted: flag(row.deleted),
    };
    const changes = (["score", "memberId", "memberName", "rank", "deleted"] as const).filter((key) => {
      if (!before) return true;
      if (key === "score") return (normalizeOcrInteger(before.score) ?? before.score) !== (normalizeOcrInteger(after.score) ?? after.score);
      return before[key] !== after[key];
    });
    return {
      id: row.id, before, previous: old, after, changes, manuallyAdded: old.manuallyAdded,
      wasSubmitted: !after.deleted && Boolean(after.memberId && after.memberName),
      evidenceFrameIndex: old.manuallyAdded ? null : before?.evidenceFrameIndex ?? null,
      deletionSource: after.deleted ? automatic.has(row.id) ? "automatic" as const : humanDeletesKnown ? "human" as const : "unknown" as const : null,
      labelStatus: "candidate" as const,
    };
  });
  return { version: 1 as const, baselineOrigin: initialRows ? "original_ocr" as const : "legacy_review_state" as const, humanDeletesKnown, rows };
}

export type OcrFeedbackPayload = ReturnType<typeof buildFeedbackPayload>;
