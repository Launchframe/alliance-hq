import { SERVER_TIME_IANA } from "@/lib/timezone/constants";

/** How a displayed clock time should be labeled for players. */
export type TimeZoneDisplayMode = "server" | "local";

export const SERVER_TIME_SHORT_LABEL = "ST";

export function getBrowserTimeZoneIana(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Short zone name for a given IANA zone at an instant (e.g. "PDT", "GMT-2").
 * Prefer {@link formatTimeZoneLabel} for user-facing suffixes — server time
 * always uses "ST" instead of the Etc/GMT+2 short name.
 */
export function getShortTimeZoneName(
  timeZone: string,
  at: Date | string = new Date(),
): string {
  const date = typeof at === "string" ? new Date(at) : at;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(date);
    const name = parts.find((part) => part.type === "timeZoneName")?.value?.trim();
    if (name) {
      return name;
    }
  } catch {
    /* invalid zone */
  }
  return timeZone;
}

/** "ST" or "Local (PDT)" — always English short labels for compact UI. */
export function formatTimeZoneLabel(
  mode: TimeZoneDisplayMode,
  at: Date | string = new Date(),
  timeZone?: string,
): string {
  if (mode === "server") {
    return SERVER_TIME_SHORT_LABEL;
  }
  const iana = timeZone ?? getBrowserTimeZoneIana();
  if (iana === SERVER_TIME_IANA) {
    return SERVER_TIME_SHORT_LABEL;
  }
  return `Local (${getShortTimeZoneName(iana, at)})`;
}

export function withTimeZoneLabel(
  formatted: string,
  mode: TimeZoneDisplayMode,
  at: Date | string = new Date(),
  timeZone?: string,
): string {
  const trimmed = formatted.trim();
  if (!trimmed) {
    return trimmed;
  }
  const label = formatTimeZoneLabel(mode, at, timeZone);
  if (trimmed.endsWith(` ${label}`) || trimmed.endsWith(label)) {
    return trimmed;
  }
  return `${trimmed} ${label}`;
}

/** True when Intl options will render a clock time (not date-only). */
export function formatOptionsIncludeClockTime(
  options: Intl.DateTimeFormatOptions,
): boolean {
  if (options.timeStyle != null) {
    return true;
  }
  if (options.hour != null || options.minute != null || options.second != null) {
    return true;
  }
  // dateStyle alone is date-only; dateStyle+timeStyle caught above.
  return false;
}

export function resolveTimeZoneDisplayMode(timeZoneIana: string): TimeZoneDisplayMode {
  return timeZoneIana === SERVER_TIME_IANA ? "server" : "local";
}
