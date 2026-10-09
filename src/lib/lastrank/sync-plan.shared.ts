import type {
  LastRankAllianceMember,
  LastRankMatchedRow,
} from "@/lib/lastrank/alliance-page.shared";

/** Interactive decisions queued in memory until the sync dispatches them. */
export type LastRankSyncPlan = {
  mapped: Array<{ row: LastRankMatchedRow; priorHqName: string }>;
  creates: LastRankAllianceMember[];
  retires: Array<{ ashedMemberId: string; memberName: string }>;
  skipped: number;
};

export type LastRankSyncPlanStats = {
  mapped: number;
  creates: number;
  retires: number;
  skipped: number;
  /** Prompts left in the current step. */
  remaining: number;
};

export type LastRankSyncPlanListener = (stats: LastRankSyncPlanStats) => void;

export function emptyLastRankSyncPlan(): LastRankSyncPlan {
  return { mapped: [], creates: [], retires: [], skipped: 0 };
}

export function lastRankSyncPlanStats(
  plan: LastRankSyncPlan,
  remaining: number,
): LastRankSyncPlanStats {
  return {
    mapped: plan.mapped.length,
    creates: plan.creates.length,
    retires: plan.retires.length,
    skipped: plan.skipped,
    remaining,
  };
}

export function lastRankSyncPlanQueuedCount(stats: LastRankSyncPlanStats): number {
  return stats.mapped + stats.creates + stats.retires;
}

export function formatLastRankSyncPlanStats(stats: LastRankSyncPlanStats): string {
  const parts = [
    `${stats.mapped} mapped`,
    `${stats.creates} to create`,
    `${stats.retires} to retire`,
    `${stats.skipped} skipped`,
  ];
  const left = stats.remaining > 0 ? `, ${stats.remaining} left in this step` : "";
  return `Queued: ${parts.join(", ")}${left} — nothing written yet.`;
}
