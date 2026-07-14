import type { DataBatchContext } from "./batch-authorization.shared";

/**
 * Ashed `bulkDeleteByDate` / `bulkMoveByDate` request shapes (from Ashed HAR).
 * Field names must match the Ashed function contract (`entity_type`, not `entity`).
 */
export function buildBulkDeletePayload(input: {
  submitEntity: string;
  recordedDate: string;
  allianceId: string;
  contextJson: DataBatchContext;
}): Record<string, unknown> {
  const context = input.contextJson;
  return {
    alliance_id: input.allianceId,
    entity_type: input.submitEntity,
    recorded_date: input.recordedDate,
    confirm: true,
    ...(context.eventId ? { event_id: context.eventId } : {}),
    ...(context.team ? { team: context.team } : {}),
    ...(context.boardKey ? { board_key: context.boardKey } : {}),
    ...(context.hqEventId ? { hq_event_id: context.hqEventId } : {}),
    ...(context.commendationId
      ? { commendation_id: context.commendationId }
      : {}),
  };
}

export function buildBulkMovePayload(input: {
  submitEntity: string;
  recordedDate: string;
  newRecordedDate: string;
  allianceId: string;
  contextJson: DataBatchContext;
}): Record<string, unknown> {
  const context = input.contextJson;
  return {
    alliance_id: input.allianceId,
    entity_type: input.submitEntity,
    from_date: input.recordedDate,
    to_date: input.newRecordedDate,
    ...(context.eventId ? { event_id: context.eventId } : {}),
    ...(context.team ? { team: context.team } : {}),
    ...(context.boardKey ? { board_key: context.boardKey } : {}),
    ...(context.hqEventId ? { hq_event_id: context.hqEventId } : {}),
    ...(context.commendationId
      ? { commendation_id: context.commendationId }
      : {}),
  };
}
