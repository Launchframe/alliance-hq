/**
 * Boards that must be recomputed after an evidence-batch retract.
 *
 * Multi-board commits store `hq_event_evidence_batches.board_id = null`, so
 * callers must also pass distinct `hq_event_observations.board_id` values for
 * the retracted batch(es). Relying on batch.boardId alone leaves member
 * results and evidence_version stale.
 */
export function boardIdsForEvidenceRetract(
  batchBoardIds: ReadonlyArray<string | null | undefined>,
  observationBoardIds: ReadonlyArray<string | null | undefined>,
): string[] {
  return [
    ...new Set(
      [...batchBoardIds, ...observationBoardIds].filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ].sort();
}
