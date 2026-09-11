import type { CalendarEntry } from "./projection.server";

type GoogleTime = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleEvent = { id?: string; etag?: string; status?: string; summary?: string; description?: string; start?: GoogleTime; end?: GoogleTime; reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] }; source?: { title?: string; url?: string }; extendedProperties?: { private?: Record<string, string> } };

export function googleEventBody(entry: Pick<CalendarEntry, "uid" | "targetId" | "revision" | "payload">, options: { origin: string; locale: string; name: string }) {
  const data = entry.payload;
  const url = new URL(`/${options.locale}${data.path}`, options.origin).href;
  return { status: "confirmed", summary: data.title, description: [data.description, url].filter(Boolean).join("\n"),
    start: data.allDay ? { date: data.start } : { dateTime: data.start }, end: data.allDay ? { date: data.end } : { dateTime: data.end },
    reminders: { useDefault: false, overrides: data.alerts.map((minutes) => ({ method: "popup", minutes })) },
    source: { title: options.name, url }, extendedProperties: { private: { hqTarget: entry.targetId, hqUid: entry.uid, hqRevision: String(entry.revision) } },
  };
}

function time(value?: GoogleTime) {
  if (value?.date) return value.date;
  const instant = Date.parse(value?.dateTime ?? "");
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}
function managedFields(event: GoogleEvent) {
  return { status: event.status, summary: event.summary ?? "", description: event.description ?? "", start: time(event.start), end: time(event.end),
    defaultReminders: event.reminders?.useDefault !== false,
    alerts: (event.reminders?.overrides ?? []).map((row) => `${row.method}:${row.minutes}`).sort(),
    source: [event.source?.title, event.source?.url], identity: [event.extendedProperties?.private?.hqTarget, event.extendedProperties?.private?.hqUid, event.extendedProperties?.private?.hqRevision],
  };
}
export function googleEventMatches(remote: GoogleEvent, desired: GoogleEvent) {
  return JSON.stringify(managedFields(remote)) === JSON.stringify(managedFields(desired));
}
