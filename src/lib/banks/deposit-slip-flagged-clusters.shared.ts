import type { DedupeCluster } from "@/lib/video/dedupe/merge-report.shared";

import type { DepositSlipReviewRowSummaryFields } from "./deposit-slip-review-row-summary.shared";

export type LiveFlaggedClusterRow = DepositSlipReviewRowSummaryFields & {
  id: string;
  dedupeClusterId?: string | null;
};

export type LiveFlaggedClusterGroup = {
  clusterId: string;
  liveRows: LiveFlaggedClusterRow[];
  reason: string | null;
  /** Report snapshots reference slipIds that no longer exist in the live table. */
  staleReport: boolean;
};

/** Group active review rows by unresolved flagged dedupe cluster id. */
export function groupUnresolvedFlaggedClusters<
  TRow extends LiveFlaggedClusterRow,
>(
  activeRows: readonly TRow[],
  unresolvedClusterIds: ReadonlySet<string>,
  reasonByClusterId: ReadonlyMap<string, string>,
  reportClusters: readonly DedupeCluster[],
): LiveFlaggedClusterGroup[] {
  const groups = new Map<string, TRow[]>();
  for (const row of activeRows) {
    const clusterId = row.dedupeClusterId;
    if (!clusterId || !unresolvedClusterIds.has(clusterId)) continue;
    const bucket = groups.get(clusterId) ?? [];
    bucket.push(row);
    groups.set(clusterId, bucket);
  }

  const reportById = new Map(
    reportClusters
      .filter((cluster) => cluster.disposition === "flagged")
      .map((cluster) => [cluster.clusterId, cluster] as const),
  );

  return [...groups.entries()].map(([clusterId, liveRows]) => {
    const reportCluster = reportById.get(clusterId);
    const liveIdSet = new Set(liveRows.map((row) => row.id));
    const staleReport =
      reportCluster != null &&
      !reportCluster.members.some((member) => liveIdSet.has(member.slipId));

    return {
      clusterId,
      liveRows: [...liveRows],
      reason: reasonByClusterId.get(clusterId) ?? reportCluster?.reason ?? null,
      staleReport,
    };
  });
}

export function otherLiveClusterRowIds(
  liveRows: readonly { id: string }[],
  keepRowId: string,
): string[] {
  return liveRows.map((row) => row.id).filter((id) => id !== keepRowId);
}

/** Flagged clusters that collapsed to a single live row — clear dedupeClusterId hygiene. */
export function flaggedClusterIdsWithSingleSurvivor<
  TRow extends { id: string; dedupeClusterId?: string | null },
>(
  activeRows: readonly TRow[],
  flaggedClusterIds: ReadonlySet<string>,
): Array<{ clusterId: string; survivorId: string }> {
  const byCluster = new Map<string, string[]>();
  for (const row of activeRows) {
    const clusterId = row.dedupeClusterId;
    if (!clusterId || !flaggedClusterIds.has(clusterId)) continue;
    const ids = byCluster.get(clusterId) ?? [];
    ids.push(row.id);
    byCluster.set(clusterId, ids);
  }

  const survivors: Array<{ clusterId: string; survivorId: string }> = [];
  for (const [clusterId, rowIds] of byCluster) {
    if (rowIds.length === 1) {
      survivors.push({ clusterId, survivorId: rowIds[0]! });
    }
  }
  return survivors;
}
