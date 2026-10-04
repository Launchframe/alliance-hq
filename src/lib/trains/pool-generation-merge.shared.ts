/**
 * Pure helpers for restoring (undoing) an accidental new pool generation.
 *
 * Available only when the immediate prior generation and the current generation
 * share no selected member IDs — so a mid-rotation "Start new rotation" can be
 * undone, while a fully exhausted gen → legitimate next gen cannot (every
 * prior member was selected, so any current pick overlaps).
 */

export type PoolGenerationMergeAssessmentInput = {
  currentGeneration: number;
  /** Immediate prior generation number, or null when none. */
  priorGeneration: number | null;
  priorSelectedMemberIds: readonly string[];
  currentSelectedMemberIds: readonly string[];
};

export type PoolGenerationMergeBlockReason =
  | "no_prior"
  | "not_adjacent"
  | "selected_overlap";

export type PoolGenerationMergeAssessment = {
  available: boolean;
  priorGeneration: number | null;
  currentGeneration: number;
  pendingDraftCount: number;
  blockReason: PoolGenerationMergeBlockReason | null;
};

export function poolGenerationsHaveSelectedOverlap(
  priorSelectedMemberIds: readonly string[],
  currentSelectedMemberIds: readonly string[],
): boolean {
  if (
    priorSelectedMemberIds.length === 0 ||
    currentSelectedMemberIds.length === 0
  ) {
    return false;
  }
  const prior = new Set(priorSelectedMemberIds);
  return currentSelectedMemberIds.some((id) => prior.has(id));
}

export function assessPoolGenerationMerge(
  input: PoolGenerationMergeAssessmentInput,
): PoolGenerationMergeAssessment {
  const pendingDraftCount = input.currentSelectedMemberIds.length;
  const base = {
    priorGeneration: input.priorGeneration,
    currentGeneration: input.currentGeneration,
    pendingDraftCount,
  };

  if (
    input.currentGeneration <= 1 ||
    input.priorGeneration == null ||
    input.priorGeneration < 1
  ) {
    return { ...base, available: false, blockReason: "no_prior" };
  }

  if (input.priorGeneration !== input.currentGeneration - 1) {
    return { ...base, available: false, blockReason: "not_adjacent" };
  }

  if (
    poolGenerationsHaveSelectedOverlap(
      input.priorSelectedMemberIds,
      input.currentSelectedMemberIds,
    )
  ) {
    return { ...base, available: false, blockReason: "selected_overlap" };
  }

  return { ...base, available: true, blockReason: null };
}
