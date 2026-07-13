/**
 * Shared shapes for parse-time dedupe/merge reports.
 * Target-agnostic — any OCR history that collapses overlapping frames can reuse these.
 */

export type DedupeDisposition = "auto_merged" | "flagged";

export type DedupeClusterMemberSnapshot = {
  /** Provisional id assigned during dedupe (survives into parsed_rows.id for survivors). */
  slipId: string;
  /** Compact snapshot for officer review banners. */
  snapshot: Record<string, unknown>;
};

export type DedupeCluster = {
  clusterId: string;
  disposition: DedupeDisposition;
  reason: string;
  /** Surviving / preferred row id (always present for auto_merged; also set for flagged). */
  destinationSlipId: string;
  members: DedupeClusterMemberSnapshot[];
  /**
   * Field keys that were majority-vote corrected during an auto-merge (e.g. one
   * outlier reading among several agreeing rows). Absent/empty when the cluster's
   * rows already agreed on every field.
   */
  correctedFields?: string[];
};

export type DedupeReport = {
  clusters: DedupeCluster[];
  /** Rows removed by auto-merge (input − output attributable to merges). */
  autoMergedCount: number;
  /** Number of flagged clusters (not row count). */
  flaggedCount: number;
  inputCount: number;
  outputCount: number;
};

export function emptyDedupeReport(inputCount = 0): DedupeReport {
  return {
    clusters: [],
    autoMergedCount: 0,
    flaggedCount: 0,
    inputCount,
    outputCount: inputCount,
  };
}

export function isDedupeReport(value: unknown): value is DedupeReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.clusters) &&
    typeof v.autoMergedCount === "number" &&
    typeof v.flaggedCount === "number" &&
    typeof v.inputCount === "number" &&
    typeof v.outputCount === "number"
  );
}
