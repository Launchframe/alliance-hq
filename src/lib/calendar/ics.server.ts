import "server-only";
import ical, { ICalAlarmType, ICalCalendarMethod, ICalEventStatus, ICalEventTransparency } from "ical-generator";
import type { CalendarEntry } from "./projection.server";

export function serializeCalendar(entries: CalendarEntry[], options: { name: string; origin: string; locale: string }) {
  const calendar = ical({ name: options.name, method: ICalCalendarMethod.PUBLISH, prodId: { company: "Alliance HQ", product: "Calendar", language: options.locale } });
  for (const entry of [...entries].sort((a, b) => a.uid.localeCompare(b.uid))) {
    const data = entry.payload;
    calendar.createEvent({ id: entry.uid, sequence: entry.revision, stamp: entry.updatedAt, lastModified: entry.updatedAt,
      start: new Date(data.start), end: new Date(data.end), allDay: data.allDay, summary: entry.cancelled ? options.name : data.title,
      description: entry.cancelled ? "" : data.description, url: entry.cancelled ? undefined : new URL(`/${options.locale}${data.path}`, options.origin).href,
      status: entry.cancelled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED, transparency: ICalEventTransparency.TRANSPARENT,
      alarms: entry.cancelled ? [] : data.alerts.map((minutes) => ({ type: ICalAlarmType.display, trigger: minutes * 60, description: data.title })),
    });
  }
  return calendar.toString();
}
