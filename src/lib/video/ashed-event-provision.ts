/**
 * Body for POST /entities/{EventEntity} when auto-provisioning on video submit
 * (no existing Ashed event row to link scores to).
 *
 * Ashed schemas differ by entity: storm / siege events require `event_date`;
 * AllianceExercise uses start/end dates.
 */
const EVENT_DATE_ENTITIES = new Set([
  "ZombieSiegeEvent",
  "DesertStormEvent",
  "CanyonStormEvent",
]);

export function buildAshedEventProvisionBody(
  eventEntity: string,
  allianceId: string,
  recordedDate: string,
): Record<string, unknown> {
  const base = { alliance_id: allianceId };

  if (EVENT_DATE_ENTITIES.has(eventEntity)) {
    return { ...base, event_date: recordedDate };
  }

  return {
    ...base,
    start_date: recordedDate,
    end_date: recordedDate,
  };
}
