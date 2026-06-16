export type QualityBucket =
  | "perfect"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "q5"
  | "dropped_the_ball";

export type QualityScoreResult = {
  qualityScore: number;
  qualityBucket: QualityBucket;
};

export type QualityInputs = {
  rowsSaved: number; // active non-deleted rows after submit
  rowsEdited: number; // rows with edited === 1
  rowsDeleted: number; // rows the user deleted before submitting
  rowsAdded: number; // manually added rows (manually_added === 1)
  status: "complete" | "discarded";
};

/**
 * Computes a quality score for a submitted or discarded video job.
 *
 * Formula: (rows_saved - rows_edited - rows_deleted - rows_added) / rows_saved
 *
 * The score is clamped to [-1, 1]; 1.0 means perfect OCR, 0.0 means every row
 * needed at least one correction.
 */
export function computeQualityScore(inputs: QualityInputs): QualityScoreResult {
  const { rowsSaved, rowsEdited, rowsDeleted, rowsAdded, status } = inputs;

  // Discarded jobs with enough rows signal a bad extraction
  if (status === "discarded" && rowsSaved >= 3) {
    return { qualityScore: -1, qualityBucket: "dropped_the_ball" };
  }

  // No rows — can't score
  if (rowsSaved === 0) {
    return { qualityScore: 0, qualityBucket: "dropped_the_ball" };
  }

  const numerator = rowsSaved - rowsEdited - rowsDeleted - rowsAdded;
  const raw = numerator / rowsSaved;
  const qualityScore = Math.max(-1, Math.min(1, raw));

  // Perfect: >= 0.95 AND no manual corrections at all
  if (qualityScore >= 0.95 && rowsDeleted === 0 && rowsAdded === 0) {
    return { qualityScore, qualityBucket: "perfect" };
  }

  // dropped_the_ball: negative score
  if (qualityScore < 0) {
    return { qualityScore, qualityBucket: "dropped_the_ball" };
  }

  // q1-q5 by quintile: [0.80, 1), [0.60, 0.80), [0.40, 0.60), [0.20, 0.40), [0, 0.20)
  if (qualityScore >= 0.8) return { qualityScore, qualityBucket: "q1" };
  if (qualityScore >= 0.6) return { qualityScore, qualityBucket: "q2" };
  if (qualityScore >= 0.4) return { qualityScore, qualityBucket: "q3" };
  if (qualityScore >= 0.2) return { qualityScore, qualityBucket: "q4" };
  return { qualityScore, qualityBucket: "q5" };
}
