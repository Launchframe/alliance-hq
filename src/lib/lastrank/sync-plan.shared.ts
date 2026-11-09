import {
  isLastRankInteractiveRename,
  type LastRankAllianceMember,
  type LastRankMatchedRow,
} from "@/lib/lastrank/alliance-page.shared";

/** Interactive decisions queued in memory until the sync dispatches them. */
export type LastRankSyncPlan = {
  mapped: Array<{ row: LastRankMatchedRow; priorHqName: string }>;
  creates: LastRankAllianceMember[];
  retires: Array<{ ashedMemberId: string; memberName: string }>;
  skipped: number;
};

/** Renames + creates that warrant an end-of-run confirmation before writes. */
export type LastRankInteractiveWriteSummary = {
  renames: Array<{ priorHqName: string; lastRankName: string; publicId: number }>;
  creates: Array<{ lastRankName: string; publicId: number }>;
};

export type LastRankInteractiveConfirmPrompt = (
  summary: LastRankInteractiveWriteSummary,
) => Promise<boolean>;

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

export function buildInteractiveWriteSummaryFromPlan(
  plan: LastRankSyncPlan,
): LastRankInteractiveWriteSummary {
  return {
    renames: plan.mapped
      .filter(({ row, priorHqName }) =>
        isLastRankInteractiveRename(priorHqName, row.lastRank.name),
      )
      .map(({ row, priorHqName }) => ({
        priorHqName,
        lastRankName: row.lastRank.name,
        publicId: row.lastRank.publicId,
      })),
    creates: plan.creates.map((member) => ({
      lastRankName: member.name,
      publicId: member.publicId,
    })),
  };
}

export function lastRankInteractiveWritesNeedConfirm(
  summary: LastRankInteractiveWriteSummary,
): boolean {
  return summary.renames.length > 0 || summary.creates.length > 0;
}

/** Human-readable lines for the interactive confirmation screen. */
export function formatLastRankInteractiveWriteSummaryLines(
  summary: LastRankInteractiveWriteSummary,
): string[] {
  const lines: string[] = [];
  if (summary.renames.length > 0) {
    lines.push("Commander renames:");
    for (const row of summary.renames) {
      lines.push(
        `  - ${row.priorHqName} → ${row.lastRankName} (public_id=${row.publicId})`,
      );
    }
  }
  if (summary.creates.length > 0) {
    lines.push("New commanders:");
    for (const row of summary.creates) {
      lines.push(`  - ${row.lastRankName} (public_id=${row.publicId})`);
    }
  }
  return lines;
}

export const LASTRANK_INTERACTIVE_CONFIRM_ABORTED =
  "Interactive sync aborted — confirmation declined; nothing was written.";
