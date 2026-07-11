import type { DataBatchContext } from "./batch-authorization.shared";

export function buildBulkDeletePayload(input: {
  submitEntity: string;
  recordedDate: string;
  allianceId: string;
  contextJson: DataBatchContext;
}): Record<string, unknown> {
  const context = input.contextJson;
  return {
    entity: input.submitEntity,
    recorded_date: input.recordedDate,
    alliance_id: input.allianceId,
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
  return {
    ...buildBulkDeletePayload(input),
    new_recorded_date: input.newRecordedDate,
  };
}
