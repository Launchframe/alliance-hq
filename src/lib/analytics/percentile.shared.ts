export type PercentileResult = {
  rank: number;
  count: number;
  /** Share of values at or below the viewer value (0–100). */
  percentile: number;
};

export function computePercentile(
  values: readonly number[],
  viewerValue: number,
): PercentileResult | null {
  if (values.length < 2) {
    return null;
  }

  const count = values.length;
  const countAtOrBelow = values.filter((value) => value <= viewerValue).length;
  const countAbove = values.filter((value) => value > viewerValue).length;
  const rank = countAbove + 1;
  const percentile = Math.round((countAtOrBelow / count) * 100);

  return { rank, count, percentile };
}

export function percentileAt(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export function computePercentileSeries(
  dailyValues: ReadonlyArray<readonly number[]>,
): Array<{
  p50: number | null;
  p90: number | null;
  p99: number | null;
  total: number | null;
}> {
  return dailyValues.map((values) => {
    if (values.length === 0) {
      return { p50: null, p90: null, p99: null, total: null };
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      p50: percentileAt(values, 50),
      p90: percentileAt(values, 90),
      p99: percentileAt(values, 99),
      total,
    };
  });
}
