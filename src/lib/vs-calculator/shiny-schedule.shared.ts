import { getServerDayOfWeek } from "@/lib/trains/game-time";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";

/** Server calendar weekday 0=Sun … 6=Sat from open timestamp (UTC−2). */
export function creationWeekdayFromOpenTimestampMs(
  openTimestampMs: number,
): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SERVER_TIME_IANA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(openTimestampMs));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return getServerDayOfWeek(`${y}-${m}-${d}`);
}

/**
 * Two shiny spawn weekdays per server (same pair every week).
 * Derived from server open DOW — validated against cpt-hedge anchors (1202–1209).
 */
export function deriveShinySpawnWeekdaysFromCreationDow(
  creationDow: number,
): [number, number] {
  const normalized = ((creationDow % 7) + 7) % 7;
  const first = (normalized + 4) % 7;
  const second = (normalized + 7) % 7;
  return first <= second ? [first, second] : [second, first];
}

export function deriveShinySpawnWeekdays(
  openTimestampMs: number,
): [number, number] {
  return deriveShinySpawnWeekdaysFromCreationDow(
    creationWeekdayFromOpenTimestampMs(openTimestampMs),
  );
}

export function isShinySpawnWeekday(
  shinyWeekdays: [number, number],
  dow: number,
): boolean {
  const n = ((dow % 7) + 7) % 7;
  return shinyWeekdays[0] === n || shinyWeekdays[1] === n;
}

export function daysUntilNextShinySpawn(
  shinyWeekdays: [number, number],
  fromDow: number,
): number {
  const from = ((fromDow % 7) + 7) % 7;
  let best = 7;
  for (const spawn of shinyWeekdays) {
    const diff = (spawn - from + 7) % 7;
    if (diff < best) best = diff;
  }
  return best;
}
