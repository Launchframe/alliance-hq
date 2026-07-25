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

export type TrainsRosterDataStatus = {
  required: boolean;
  ready: boolean;
  activeMemberCount: number;
  eligiblePoolCount: number;
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

export function buildRosterDataStatus(input: {
  needKind: RosterNeedKind;
  activeMemberCount: number;
  eligiblePoolCount: number;
  syncCapability: RosterSyncCapabilityKind;
  poolType: RosterRankPoolType | null;
  lastSyncedAt?: string | null;
}): TrainsRosterDataStatus {
  const required =
    input.activeMemberCount === 0 ||
    (input.needKind === "rank_pool" && input.eligiblePoolCount === 0);
  const ready =
    input.activeMemberCount > 0 &&
    (input.needKind !== "rank_pool" || input.eligiblePoolCount > 0);

  return {
    required,
    ready,
    activeMemberCount: input.activeMemberCount,
    eligiblePoolCount: input.eligiblePoolCount,
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
