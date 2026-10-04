import {
  getZonedDateTimeParts,
  zonedDateTimeToIso,
} from "@/lib/battle-plan/time-display.shared";
import { serverTimestampFromCalendarAndTime } from "@/lib/eur/schedule-engine";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export type RegularEventTimeZoneMode = "server" | "local";

export const REGULAR_EVENT_TIME_ZONE_STORAGE_KEY =
  "alliance-hq-regular-event-time-zone-v1";

export function isRegularEventTimeZoneMode(
  value: string,
): value is RegularEventTimeZoneMode {
  return value === "server" || value === "local";
}

export function readStoredRegularEventTimeZoneMode(): RegularEventTimeZoneMode {
  if (typeof window === "undefined") return "server";
  try {
    const raw = window.localStorage.getItem(
      REGULAR_EVENT_TIME_ZONE_STORAGE_KEY,
    );
    if (raw && isRegularEventTimeZoneMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "server";
}

export function writeStoredRegularEventTimeZoneMode(
  mode: RegularEventTimeZoneMode,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REGULAR_EVENT_TIME_ZONE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function browserIana(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Convert a stored ST HH:MM into the display zone for an ST calendar date. */
export function displayTimeFromServerTime(
  timeSt: string,
  mode: RegularEventTimeZoneMode,
  dateSt: string = getServerCalendarDate(),
): string {
  if (mode === "server") return timeSt;
  const instant = serverTimestampFromCalendarAndTime(dateSt, timeSt);
  return getZonedDateTimeParts(instant, browserIana()).time;
}

/** Convert a displayed HH:MM back to ST for storage. */
export function serverTimeFromDisplayTime(
  displayTime: string,
  mode: RegularEventTimeZoneMode,
  dateSt: string = getServerCalendarDate(),
): string {
  if (mode === "server") return displayTime;
  const iso = zonedDateTimeToIso(dateSt, displayTime, browserIana());
  return getZonedDateTimeParts(iso, SERVER_TIME_IANA).time;
}
