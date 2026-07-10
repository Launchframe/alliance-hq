import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

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

export function groupEventsByServerDate(
  events: readonly SerializedCaptureEvent[],
): Map<string, SerializedCaptureEvent[]> {
  const grouped = new Map<string, SerializedCaptureEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.serverCalendarDate) ?? [];
    bucket.push(event);
    grouped.set(event.serverCalendarDate, bucket);
  }
  for (const bucket of grouped.values()) {
    bucket.sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
  }
  return grouped;
}
