import { SERVER_TIME_IANA } from "@/lib/timezone/constants";

export type BattlePlanTimeDisplay = "local" | "server";

export const BATTLE_PLAN_TIME_DISPLAY_STORAGE_KEY =
  "alliance-hq-battle-plan-time-display-v1";

const DEFAULT_DISPLAY: BattlePlanTimeDisplay = "local";

export function isBattlePlanTimeDisplay(
  value: string,
): value is BattlePlanTimeDisplay {
  return value === "local" || value === "server";
}

export function readStoredBattlePlanTimeDisplay(): BattlePlanTimeDisplay {
  if (typeof window === "undefined") {
    return DEFAULT_DISPLAY;
  }
  try {
    const raw = window.localStorage.getItem(BATTLE_PLAN_TIME_DISPLAY_STORAGE_KEY);
    if (raw && isBattlePlanTimeDisplay(raw)) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_DISPLAY;
}

export function writeStoredBattlePlanTimeDisplay(
  display: BattlePlanTimeDisplay,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(BATTLE_PLAN_TIME_DISPLAY_STORAGE_KEY, display);
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveBattlePlanIana(
  display: BattlePlanTimeDisplay,
): string {
  if (display === "server") {
    return SERVER_TIME_IANA;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const offsetStr =
    formatted.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:(\+|-)(\d{1,2})(?::(\d{2}))?)?$/.exec(offsetStr);
  if (!match || !match[1]) {
    return 0;
  }
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

export type ZonedDateTimeParts = {
  date: string;
  time: string;
};

export function getZonedDateTimeParts(
  instant: Date | string,
  timeZone: string,
): ZonedDateTimeParts {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export function zonedDateTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!dateMatch || !timeMatch) {
    return new Date(NaN).toISOString();
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  const offsetMs = getTimeZoneOffsetMs(timeZone, anchor);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return new Date(localAsUtc - offsetMs).toISOString();
}

/** Defaults to now in the active zone; optional server calendar day from the grid. */
export function buildDefaultCaptureDateTime(
  display: BattlePlanTimeDisplay,
  preferredServerDate?: string | null,
  now = new Date(),
): ZonedDateTimeParts {
  const timeZone = resolveBattlePlanIana(display);
  const nowParts = getZonedDateTimeParts(now, timeZone);
  if (!preferredServerDate) {
    return nowParts;
  }
  if (display === "server") {
    return { date: preferredServerDate, time: nowParts.time };
  }
  const noonOnServerDay = zonedDateTimeToIso(
    preferredServerDate,
    "12:00",
    SERVER_TIME_IANA,
  );
  return {
    date: getZonedDateTimeParts(noonOnServerDay, timeZone).date,
    time: nowParts.time,
  };
}

export function formatCaptureTime(
  iso: string,
  display: BattlePlanTimeDisplay,
): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveBattlePlanIana(display),
    hour: "numeric",
    minute: "2-digit",
    hour12: display !== "server",
  }).format(new Date(iso));
}

export function formatCaptureDateTime(
  iso: string,
  display: BattlePlanTimeDisplay,
): string {
  if (display === "server") {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: resolveBattlePlanIana(display),
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveBattlePlanIana(display),
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}
