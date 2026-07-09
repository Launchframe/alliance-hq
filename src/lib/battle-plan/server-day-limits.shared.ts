import { MAX_CAPTURES_PER_SERVER_DAY } from "@/lib/battle-plan/types.shared";
import type { TerritoryType } from "@/lib/battle-plan/types.shared";

export type CaptureEventLimitRow = {
  id: string;
  serverCalendarDate: string;
  territoryType: TerritoryType;
  status: string;
};

export function countScheduledCapturesForDay(
  events: readonly CaptureEventLimitRow[],
  serverCalendarDate: string,
  territoryType: TerritoryType,
  excludeEventId?: string,
): number {
  return events.filter(
    (event) =>
      event.status === "scheduled" &&
      event.serverCalendarDate === serverCalendarDate &&
      event.territoryType === territoryType &&
      event.id !== excludeEventId,
  ).length;
}

export function validateServerDayCaptureLimit(input: {
  events: readonly CaptureEventLimitRow[];
  serverCalendarDate: string;
  territoryType: TerritoryType;
  excludeEventId?: string;
}): string | null {
  const count = countScheduledCapturesForDay(
    input.events,
    input.serverCalendarDate,
    input.territoryType,
    input.excludeEventId,
  );
  if (count >= MAX_CAPTURES_PER_SERVER_DAY) {
    const label = input.territoryType === "stronghold" ? "stronghold" : "city";
    return `This server day already has ${MAX_CAPTURES_PER_SERVER_DAY} scheduled ${label} captures.`;
  }
  return null;
}
