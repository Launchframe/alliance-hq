import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import { withTimeZoneLabel } from "@/lib/timezone/zone-label.shared";

export type CoverageDisplayZone = "local" | "server";

/** UTC hour (0–23) → display hour in the chosen zone. */
export function utcHourToDisplayHour(
  utcHour: number,
  zone: CoverageDisplayZone,
): number {
  const ref = new Date(Date.UTC(2024, 0, 1, utcHour, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone === "server" ? SERVER_TIME_IANA : undefined,
    hour: "numeric",
    hour12: false,
  }).formatToParts(ref);
  const hourPart = parts.find((p) => p.type === "hour");
  return Number(hourPart?.value ?? utcHour) % 24;
}

/** Display hour in zone → UTC hour (0–23). */
export function displayHourToUtcHour(
  displayHour: number,
  zone: CoverageDisplayZone,
): number {
  const normalized = ((displayHour % 24) + 24) % 24;
  if (zone === "local") {
    const now = new Date();
    const localOffsetMin = now.getTimezoneOffset();
    const utc = (normalized + localOffsetMin / 60 + 24) % 24;
    return Math.floor(utc);
  }
  // Server time is fixed UTC−2
  return (normalized + 2 + 24) % 24;
}

export function formatCoverageHourLabel(
  hour: number,
  zone: CoverageDisplayZone,
): string {
  const ref = new Date(Date.UTC(2024, 0, 1, hour, 0, 0));
  const timeZone = zone === "server" ? SERVER_TIME_IANA : undefined;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(ref);
  return withTimeZoneLabel(formatted, zone, ref, timeZone);
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const ms = Date.now() - then.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
