import { computeVrPercentile, type VrPercentileResult } from "@/lib/vr/percentile";

export type KillsPercentileResult = VrPercentileResult;

export function computeKillsPercentile(
  reporterKills: readonly number[],
  viewerKills: number,
): KillsPercentileResult | null {
  return computeVrPercentile(reporterKills, viewerKills);
}
