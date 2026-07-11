/**
 * Shared My THP chart / stale-report helpers (client-safe).
 */

export const THP_STALE_REPORT_MS = 7 * 24 * 60 * 60 * 1000;

export type ThpChartPoint = {
  total: number;
  createdAt: string;
};

/** Pad the y-domain so min/max are not flush with the plot edges (avoids looking like "0"). */
export function thpChartYDomain(
  totals: number[],
  padRatio = 0.15,
): { min: number; max: number; span: number } {
  if (totals.length === 0) {
    return { min: 0, max: 1, span: 1 };
  }
  const dataMin = Math.min(...totals);
  const dataMax = Math.max(...totals);
  const rawSpan = Math.max(dataMax - dataMin, 1);
  const pad = rawSpan * padRatio;
  const min = Math.max(0, dataMin - pad);
  const max = dataMax + pad;
  return { min, max, span: Math.max(max - min, 1) };
}

/**
 * Total growth for analytics: last − first.
 * When the series ends below its peak (e.g. stale Ashed overwrite), report peak − first
 * so members still see progress they actually achieved.
 */
export function computeThpTotalGrowth(events: ThpChartPoint[]): number | null {
  if (events.length < 2) return null;
  const first = events[0]!.total;
  const last = events[events.length - 1]!.total;
  const peak = Math.max(...events.map((event) => event.total));
  if (last < peak) {
    return peak - first;
  }
  return last - first;
}

export function isThpReportStale(
  lastReportedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!lastReportedAt) return false;
  const reportedMs = new Date(lastReportedAt).getTime();
  if (!Number.isFinite(reportedMs)) return false;
  return nowMs - reportedMs >= THP_STALE_REPORT_MS;
}

export function resolveThpLastReportedAt(input: {
  updatedAt?: string | null;
  events: Array<{ createdAt: string }>;
}): string | null {
  if (input.updatedAt) return input.updatedAt;
  if (input.events.length === 0) return null;
  return input.events[input.events.length - 1]!.createdAt;
}
