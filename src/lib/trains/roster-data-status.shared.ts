/**
 * Pure helpers for Trains Simple Mode roster readiness.
 * Server loaders count members and probe pool eligibility; these classify need
 * and build the payload shape.
 */

import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { conductorMechanismPoolType } from "@/lib/trains/templates";

export type RosterSyncCapabilityKind =
  | "officer_ashed"
  | "alliance_ashed"
  | "native_reload"
  | "none";

export type RosterRankPoolType = "r3" | "r4_plus" | "heavy_hitter";

export type RosterNeedKind = "none" | "rank_pool" | "members";

export type RosterBlockerKind =
  | "empty_roster"
  | "missing_rank_pool"
  | "conductor_minimums"
  | null;

export type TrainsRosterDataStatus = {
  required: boolean;
  ready: boolean;
  activeMemberCount: number;
  eligiblePoolCount: number;
  /** Members matching today's rank pool before conductor minimums. */
  rankEligiblePoolCount: number;
  blockerKind: RosterBlockerKind;
  syncCapability: RosterSyncCapabilityKind;
  needKind: RosterNeedKind;
  poolType: RosterRankPoolType | null;
  lastSyncedAt: string | null;
};

export type ClassifyRosterNeedInput = {
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  date?: string | null;
};

export function classifyRosterNeed(
  input: ClassifyRosterNeedInput,
): { kind: RosterNeedKind; poolType: RosterRankPoolType | null } {
  const mechanism = effectiveConductorMechanism(
    input.conductorMechanism,
    input.paintTemplate as Parameters<
      typeof effectiveConductorMechanism
    >[1],
    input.date,
  );
  if (!mechanism) {
    return { kind: "members", poolType: null };
  }

  const poolType = conductorMechanismPoolType(mechanism);
  if (
    poolType === "r3" ||
    poolType === "r4_plus" ||
    poolType === "heavy_hitter"
  ) {
    return { kind: "rank_pool", poolType };
  }

  return { kind: "members", poolType: null };
}

export function classifyRosterBlocker(input: {
  needKind: RosterNeedKind;
  activeMemberCount: number;
  eligiblePoolCount: number;
  rankEligiblePoolCount: number;
}): RosterBlockerKind {
  if (input.eligiblePoolCount > 0) {
    return null;
  }
  if (input.activeMemberCount === 0) {
    return "empty_roster";
  }
  if (input.needKind !== "rank_pool") {
    return null;
  }
  if (input.rankEligiblePoolCount > 0) {
    return "conductor_minimums";
  }
  return "missing_rank_pool";
}

export function buildRosterDataStatus(input: {
  needKind: RosterNeedKind;
  activeMemberCount: number;
  eligiblePoolCount: number;
  rankEligiblePoolCount?: number;
  syncCapability: RosterSyncCapabilityKind;
  poolType: RosterRankPoolType | null;
  lastSyncedAt?: string | null;
}): TrainsRosterDataStatus {
  const rankEligiblePoolCount =
    input.rankEligiblePoolCount ?? input.eligiblePoolCount;
  const required =
    input.activeMemberCount === 0 ||
    (input.needKind === "rank_pool" && rankEligiblePoolCount === 0);
  const ready =
    input.activeMemberCount > 0 &&
    (input.needKind !== "rank_pool" || rankEligiblePoolCount > 0);
  const blockerKind = classifyRosterBlocker({
    needKind: input.needKind,
    activeMemberCount: input.activeMemberCount,
    eligiblePoolCount: input.eligiblePoolCount,
    rankEligiblePoolCount,
  });

  return {
    required,
    ready,
    activeMemberCount: input.activeMemberCount,
    eligiblePoolCount: input.eligiblePoolCount,
    rankEligiblePoolCount,
    blockerKind,
    syncCapability: input.syncCapability,
    needKind: input.needKind,
    poolType: input.poolType,
    lastSyncedAt: input.lastSyncedAt ?? null,
  };
}

export function rosterSyncCapabilityAllowsInPageSync(
  capability: RosterSyncCapabilityKind,
): boolean {
  return (
    capability === "officer_ashed" ||
    capability === "alliance_ashed" ||
    capability === "native_reload"
  );
}
