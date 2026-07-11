import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import {
  conductorMechanismPoolType,
  vipMechanismPoolType,
} from "@/lib/trains/templates";
import type { PoolType, VipMechanismType, WeekTemplateType } from "@/lib/trains/types";

export type PoolSpinSource = {
  kind: "pool";
  poolType: PoolType;
};

export type VsLeaderboardSpinSource = {
  kind: "vs_leaderboard";
  topN: number;
};

export type DonationsLeaderboardSpinSource = {
  kind: "donations_leaderboard";
  rank: 1 | 2;
};

export type EventLeaderboardSpinSource = {
  kind: "event_leaderboard";
};

export type SpinSource =
  | PoolSpinSource
  | VsLeaderboardSpinSource
  | DonationsLeaderboardSpinSource
  | EventLeaderboardSpinSource
  | null;

export function conductorSpinSource(
  conductorMechanism: string | null | undefined,
  paintTemplate?: WeekTemplateType | null,
  date?: string | null,
): SpinSource {
  const mechanism = effectiveConductorMechanism(
    conductorMechanism,
    paintTemplate,
    date,
  );
  if (!mechanism) return null;

  const poolType = conductorMechanismPoolType(mechanism);
  if (poolType) {
    return { kind: "pool", poolType };
  }

  if (mechanism === "vs_top_10") {
    return { kind: "vs_leaderboard", topN: 10 };
  }
  if (mechanism === "vs_high_score") {
    return { kind: "vs_leaderboard", topN: 1 };
  }
  if (mechanism === "donations_top") {
    return { kind: "donations_leaderboard", rank: 1 };
  }

  return null;
}

export function vipSpinSource(
  vipMechanism: string | null | undefined,
): SpinSource {
  if (!vipMechanism || vipMechanism === "none" || vipMechanism === "conductor_pick") {
    return null;
  }
  if (vipMechanism === "donations_second") {
    return { kind: "donations_leaderboard", rank: 2 };
  }
  const poolType = vipMechanismPoolType(vipMechanism as VipMechanismType);
  if (poolType) {
    return { kind: "pool", poolType };
  }
  return null;
}

export function isPoolSpinSource(
  source: SpinSource,
): source is PoolSpinSource {
  return source?.kind === "pool";
}
