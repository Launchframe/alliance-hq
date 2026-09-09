import { percentileAt } from "@/lib/analytics/percentile.shared";
import { addCalendarDays } from "@/lib/trains/game-time";

export type CommanderThpHistoryEvent = {
  commanderId: string;
  total: number;
  /** Server calendar YYYY-MM-DD */
  recordedDate: string;
};

export type ThpHistoryPoint = {
  recordedDate: string;
  thpTotal: number;
  thpP50: number | null;
  thpP90: number | null;
  thpP99: number | null;
};

function aggregatesFromValues(values: number[]): Omit<ThpHistoryPoint, "recordedDate"> | null {
  if (values.length === 0) return null;
  const thpTotal = values.reduce((sum, value) => sum + value, 0);
  return {
    thpTotal,
    thpP50: percentileAt(values, 50),
    thpP90: percentileAt(values, 90),
    thpP99: percentileAt(values, 99),
  };
}

/**
 * Build a daily THP series by replaying commander events in calendar order and
 * carrying the latest known total forward each day until `endDate`.
 */
export function buildThpHistorySeriesFromEvents(
  events: readonly CommanderThpHistoryEvent[],
  options: { startDate: string | null; endDate: string },
): ThpHistoryPoint[] {
  const positive = events.filter(
    (event) =>
      Number.isFinite(event.total) &&
      event.total > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(event.recordedDate),
  );
  if (positive.length === 0) return [];

  const byDate = new Map<string, CommanderThpHistoryEvent[]>();
  for (const event of positive) {
    const list = byDate.get(event.recordedDate) ?? [];
    list.push(event);
    byDate.set(event.recordedDate, list);
  }

  const firstDate = [...byDate.keys()].sort()[0]!;
  const start =
    options.startDate && options.startDate > firstDate
      ? options.startDate
      : firstDate;
  if (start > options.endDate) return [];

  const running = new Map<string, number>();
  const out: ThpHistoryPoint[] = [];

  // Replay days before the visible window so carry-forward is correct.
  for (
    let day = firstDate;
    day < start;
    day = addCalendarDays(day, 1)
  ) {
    for (const event of byDate.get(day) ?? []) {
      running.set(event.commanderId, Math.round(event.total));
    }
  }

  for (
    let day = start;
    day <= options.endDate;
    day = addCalendarDays(day, 1)
  ) {
    for (const event of byDate.get(day) ?? []) {
      running.set(event.commanderId, Math.round(event.total));
    }
    const aggregates = aggregatesFromValues([...running.values()]);
    if (!aggregates) continue;
    out.push({ recordedDate: day, ...aggregates });
  }

  return out;
}
