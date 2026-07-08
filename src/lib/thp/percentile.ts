import { computeVrPercentile, type VrPercentileResult } from "@/lib/vr/percentile";

export type ThpPercentileResult = VrPercentileResult;

export function computeThpPercentile(
  reporterThps: readonly number[],
  viewerThp: number,
): ThpPercentileResult | null {
  return computeVrPercentile(reporterThps, viewerThp);
}
