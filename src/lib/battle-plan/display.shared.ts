import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";
import {
  getZonedDateTimeParts,
  resolveBattlePlanIana,
  type BattlePlanTimeDisplay,
} from "@/lib/battle-plan/time-display.shared";

export function listUpcomingCaptureEvents(
  events: readonly SerializedCaptureEvent[],
  now = new Date(),
): SerializedCaptureEvent[] {
  const nowMs = now.getTime();
  return events
    .filter(
      (event) =>
        event.status === "scheduled" &&
        new Date(event.scheduledAt).getTime() >= nowMs,
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
}

/** Calendar day key for an event in the active time-display mode. */
export function eventDisplayCalendarDate(
  event: SerializedCaptureEvent,
  timeDisplay: BattlePlanTimeDisplay,
  timeZone = resolveBattlePlanIana(timeDisplay),
): string {
  if (timeDisplay === "server") {
    return event.serverCalendarDate;
  }
  return getZonedDateTimeParts(event.scheduledAt, timeZone).date;
}

export function groupEventsByCalendarDate(
  events: readonly SerializedCaptureEvent[],
  timeDisplay: BattlePlanTimeDisplay,
  timeZone = resolveBattlePlanIana(timeDisplay),
): Map<string, SerializedCaptureEvent[]> {
  const grouped = new Map<string, SerializedCaptureEvent[]>();
  for (const event of events) {
    const date = eventDisplayCalendarDate(event, timeDisplay, timeZone);
    const bucket = grouped.get(date) ?? [];
    bucket.push(event);
    grouped.set(date, bucket);
  }
  for (const bucket of grouped.values()) {
    bucket.sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
  }
  return grouped;
}

export function groupEventsByServerDate(
  events: readonly SerializedCaptureEvent[],
): Map<string, SerializedCaptureEvent[]> {
  return groupEventsByCalendarDate(events, "server");
}
