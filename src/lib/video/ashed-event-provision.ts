/**
 * Body for POST /entities/{EventEntity} when auto-provisioning on video submit
 * (no existing Ashed event row to link scores to).
 */
export function buildAshedEventProvisionBody(
  eventEntity: string,
  allianceId: string,
  recordedDate: string,
): Record<string, unknown> {
  const base = { alliance_id: allianceId };

  if (eventEntity === "ZombieSiegeEvent") {
    return { ...base, event_date: recordedDate };
  }

  return {
    ...base,
    start_date: recordedDate,
    end_date: recordedDate,
  };
}
