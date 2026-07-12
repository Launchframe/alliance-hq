import type { StatSyncReviewRow } from "@/lib/hq-ashed-stat-sync/types";

/** Merge outbound pending + inbound conflicts; inbound wins on same commander (has ashedTotal). */
export function mergeStatSyncReviewRows(
  outbound: StatSyncReviewRow[],
  conflicts: StatSyncReviewRow[],
): StatSyncReviewRow[] {
  const byCommander = new Map<string, StatSyncReviewRow>();

  for (const row of outbound) {
    byCommander.set(row.commanderId, row);
  }

  for (const conflict of conflicts) {
    const existing = byCommander.get(conflict.commanderId);
    if (existing) {
      byCommander.set(conflict.commanderId, {
        ...conflict,
        eventId: conflict.eventId ?? existing.eventId,
        hqSource: conflict.hqSource ?? existing.hqSource,
        hqUpdatedAt: conflict.hqUpdatedAt ?? existing.hqUpdatedAt,
      });
    } else {
      byCommander.set(conflict.commanderId, conflict);
    }
  }

  return [...byCommander.values()];
}
