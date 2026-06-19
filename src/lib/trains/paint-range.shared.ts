import { addCalendarDays } from "@/lib/trains/game-time";

export function expandPaintRange(from: string, to: string): string[] {
  if (from === to) return [from];
  const dates: string[] = [];
  const step = from <= to ? 1 : -1;
  let cursor = from;
  while (true) {
    dates.push(cursor);
    if (cursor === to) break;
    cursor = addCalendarDays(cursor, step);
  }
  return dates;
}
