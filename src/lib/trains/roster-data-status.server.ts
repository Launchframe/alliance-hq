import "server-only";

import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { getAllianceRosterLastSyncedAt } from "@/lib/members/roster.server";
import { resolveRosterSyncCapability } from "@/lib/members/roster-sync-capability.server";
import {
  buildRosterDataStatus,
  classifyRosterNeed,
  type TrainsRosterDataStatus,
} from "@/lib/trains/roster-data-status.shared";
import { countEligiblePoolMembers, countRankEligiblePoolMembers } from "@/lib/trains/service";

export type { TrainsRosterDataStatus };

export async function loadTrainsRosterDataStatus(input: {
  sessionId: string;
  allianceId: string;
  trainDate: string;
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  activeMemberCount?: number;
}): Promise<TrainsRosterDataStatus> {
  const activeMemberCount =
    input.activeMemberCount ??
    (await loadActiveAlliancePoolMembers({ allianceId: input.allianceId }))
      .length;

  const need = classifyRosterNeed({
    conductorMechanism: input.conductorMechanism,
    paintTemplate: input.paintTemplate,
    date: input.trainDate,
  });

  let eligiblePoolCount = 0;
  let rankEligiblePoolCount = 0;
  if (need.kind === "rank_pool" && need.poolType && activeMemberCount > 0) {
    const probe = {
      hqAllianceId: input.allianceId,
      poolType: need.poolType,
      date: input.trainDate,
      conductorMechanism: input.conductorMechanism,
      paintTemplate: input.paintTemplate as Parameters<
        typeof countEligiblePoolMembers
      >[0]["paintTemplate"],
    };
    [eligiblePoolCount, rankEligiblePoolCount] = await Promise.all([
      countEligiblePoolMembers(probe),
      countRankEligiblePoolMembers(probe),
    ]);
  }

  const [{ kind: syncCapability }, lastSyncedAt] = await Promise.all([
    resolveRosterSyncCapability(input.sessionId, input.allianceId),
    getAllianceRosterLastSyncedAt(input.allianceId),
  ]);

  return buildRosterDataStatus({
    needKind: need.kind,
    activeMemberCount,
    eligiblePoolCount,
    rankEligiblePoolCount,
    syncCapability,
    poolType: need.poolType,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  });
}
