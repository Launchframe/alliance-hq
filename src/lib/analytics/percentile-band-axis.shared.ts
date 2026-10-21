/** Left axis: P50 / P90 / P99 and the viewer marker. */
export const PERCENTILE_BAND_DISTRIBUTION_AXIS_ID = "distribution";

/** Right axis: alliance total, so it does not share a scale with member lines. */
export const PERCENTILE_BAND_TOTAL_AXIS_ID = "total";

export type PercentileBandAxisPoint = {
  total?: number | null;
  p50?: number | null;
  p90?: number | null;
  p99?: number | null;
};

export type PercentileBandAxisDomains = {
  left: [number, number] | undefined;
  right: [number, number] | undefined;
};

function finiteMax(values: ReadonlyArray<number | null | undefined>): number | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    if (value > max) max = value;
  }
  return Number.isFinite(max) ? max : null;
}

/** Round a positive max up to a 1/2/5 step so axis ticks stay readable. */
export function niceAxisMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const padded = value * 1.05;
  const exponent = Math.floor(Math.log10(padded));
  const magnitude = 10 ** exponent;
  const fraction = padded / magnitude;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Number((niceFraction * magnitude).toPrecision(12));
}

function zeroBasedDomain(max: number | null): [number, number] | undefined {
  if (max == null) return undefined;
  return [0, niceAxisMax(max)];
}

/**
 * Independent zero-based domains. The viewer marker is part of the left
 * domain so a personal THP above P99 still lands on the member scale.
 */
export function percentileBandAxisDomains(
  data: readonly PercentileBandAxisPoint[],
  viewerValue?: number | null,
): PercentileBandAxisDomains {
  const distribution: Array<number | null | undefined> = [];
  const totals: Array<number | null | undefined> = [];
  for (const point of data) {
    distribution.push(point.p50, point.p90, point.p99);
    totals.push(point.total);
  }
  distribution.push(viewerValue);
  return {
    left: zeroBasedDomain(finiteMax(distribution)),
    right: zeroBasedDomain(finiteMax(totals)),
  };
}
