/**
 * Body for POST /entities/{EventEntity} when auto-provisioning on video submit
 * (no existing Ashed event row to link scores to).
 *
 * Ashed schemas differ by entity: storm / siege events require `event_date`;
 * AllianceExercise uses start/end dates.
 *
 * Events are unique by alliance + date (team A/B lives on score rows for DS/CS).
 */
const EVENT_DATE_ENTITIES = new Set([
  "ZombieSiegeEvent",
  "DesertStormEvent",
  "CanyonStormEvent",
]);

export function usesEventDateField(eventEntity: string): boolean {
  return EVENT_DATE_ENTITIES.has(eventEntity);
}

export function buildAshedEventProvisionBody(
  eventEntity: string,
  allianceId: string,
  recordedDate: string,
): Record<string, unknown> {
  const base = { alliance_id: allianceId };

  if (usesEventDateField(eventEntity)) {
    return { ...base, event_date: recordedDate };
  }

  return {
    ...base,
    start_date: recordedDate,
    end_date: recordedDate,
  };
}

export function buildAshedEventLookupQuery(
  eventEntity: string,
  allianceId: string,
  recordedDate: string,
): Record<string, string> {
  if (usesEventDateField(eventEntity)) {
    return { alliance_id: allianceId, event_date: recordedDate };
  }
  return {
    alliance_id: allianceId,
    start_date: recordedDate,
  };
}

/** Calendar date prefix YYYY-MM-DD from an Ashed event row. */
export function ashedEventCalendarDate(event: {
  event_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  recorded_date?: string | null;
  date?: string | null;
}): string | null {
  for (const raw of [
    event.event_date,
    event.start_date,
    event.end_date,
    event.recorded_date,
    event.date,
  ]) {
    const part = raw?.trim().slice(0, 10);
    if (part && /^\d{4}-\d{2}-\d{2}$/.test(part)) {
      return part;
    }
  }
  return null;
}

export function pickAshedEventMatchingDate<
  T extends {
    id?: string;
    event_date?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    recorded_date?: string | null;
    date?: string | null;
  },
>(events: T[], recordedDate: string): T | null {
  const want = recordedDate.trim().slice(0, 10);
  if (!want) return null;
  for (const event of events) {
    if (!event.id) continue;
    if (ashedEventCalendarDate(event) === want) {
      return event;
    }
  }
  return null;
}
