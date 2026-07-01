export type VrPercentileResult = {
  rank: number;
  reporterCount: number;
  /** Share of reporters at or below the viewer's VR (0–100). */
  percentile: number;
};

/**
 * Rank reporters by highest VR descending. Members with no season row are excluded
 * by the caller — pass only reporter VR values.
 */
export function computeVrPercentile(
  reporterVrs: readonly number[],
  viewerVr: number,
): VrPercentileResult | null {
  if (reporterVrs.length < 2) {
    return null;
  }

  const reporterCount = reporterVrs.length;
  const countAtOrBelow = reporterVrs.filter((vr) => vr <= viewerVr).length;
  const countAbove = reporterVrs.filter((vr) => vr > viewerVr).length;
  const rank = countAbove + 1;
  const percentile = Math.round((countAtOrBelow / reporterCount) * 100);

  return { rank, reporterCount, percentile };
}
