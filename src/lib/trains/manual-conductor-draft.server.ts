import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  depletingManualPickErrorMessage,
  evaluateDepletingManualPick,
} from "@/lib/trains/depleting-manual-pick.shared";
import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";
import {
  listPoolEntries,
  listUnselectedPoolEntries,
  markPoolMemberSelectedForDate,
  releasePoolSelectionForDate,
} from "@/lib/trains/pool";
import {
  getMemberRankAsOf,
  isMemberEligibleForPool,
  resolveMemberAllianceRankAsOf,
} from "@/lib/trains/rank-history";
import {
  getConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import { ensureConductorPoolSeeded } from "@/lib/trains/service";
import {
  conductorMechanismPoolType,
  supportsManualConductorPick,
} from "@/lib/trains/templates";

/**
 * Shared path for HQ web manual pick and Discord `/set-conductor`.
 * Depleting lottery/sequence days must consume (and gate) pool slots the same
 * way — Discord previously drafted without marking the pool, so the wheel could
 * re-draw the same conductor in the same generation.
 */
export async function applyManualConductorDraft(input: {
  allianceId: string;
  date: string;
  memberId: string;
  memberName: string;
}): Promise<typeof import("@/lib/db/schema").trainConductorRecords.$inferSelect> {
  const seasonKey = (await getEffectiveSeasonForAlliance(input.allianceId))
    .seasonKey;
  const existing = await getConductorRecord(
    input.allianceId,
    input.date,
    seasonKey,
  );
  if (existing?.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    seasonKey,
  );
  const mechanism = dayConfig.conductorMechanism;
  if (!supportsManualConductorPick(mechanism)) {
    throw new Error("Manual conductor pick is not allowed for this day.");
  }

  const depletingPool =
    !isPriceIsRightPaintTemplate(dayConfig.paintTemplate) &&
    Boolean(conductorMechanismPoolType(mechanism));

  if (existing?.conductorMemberId && depletingPool) {
    await releasePoolSelectionForDate(
      input.allianceId,
      input.date,
      existing.conductorMemberId,
    );
  }

  const rankEvent = await getMemberRankAsOf(
    input.allianceId,
    input.memberId,
    input.date,
  );

  if (dayConfig.paintTemplate === "r3_recognition") {
    const { loadActiveAlliancePoolMembers } = await import(
      "@/lib/members/game-roster"
    );
    const members = await loadActiveAlliancePoolMembers({
      allianceId: input.allianceId,
    });
    const rosterMember = members.find(
      (m) => m.ashedMemberId === input.memberId,
    );
    const resolvedRank = await resolveMemberAllianceRankAsOf(
      input.allianceId,
      input.memberId,
      input.date,
      rosterMember?.allianceRank ?? null,
      rosterMember?.allianceRankTitle ?? null,
    );
    if (!isMemberEligibleForPool("r3", resolvedRank.rank)) {
      throw new Error("R3 recognition awards must pick an R3 member.");
    }
  }

  const poolType = depletingPool
    ? conductorMechanismPoolType(mechanism)
    : null;
  if (poolType) {
    await ensureConductorPoolSeeded({
      hqAllianceId: input.allianceId,
      poolType,
      date: input.date,
      useSequence: mechanism === "r4_sequence",
      paintTemplate: dayConfig.paintTemplate,
      respectConductorMinimums: false,
    });
    const [unselected, poolEntries] = await Promise.all([
      listUnselectedPoolEntries(input.allianceId, poolType),
      listPoolEntries(input.allianceId, poolType),
    ]);
    const gate = evaluateDepletingManualPick({
      memberId: input.memberId,
      unselectedMemberIds: unselected.map((row) => row.memberId),
      poolMemberIds: poolEntries.map((row) => row.memberId),
    });
    if (!gate.ok) {
      throw new Error(depletingManualPickErrorMessage(gate.reason));
    }
    await markPoolMemberSelectedForDate(
      input.allianceId,
      poolType,
      input.memberId,
      input.date,
    );
  }

  return upsertConductorDraft({
    allianceId: input.allianceId,
    date: input.date,
    seasonKey,
    conductorMemberId: input.memberId,
    conductorMemberName: input.memberName,
    conductorRankEventId: rankEvent?.id ?? null,
    conductorMechanism: mechanism,
    vipMechanism: dayConfig.vipMechanism ?? null,
    dayConfigId: dayConfig.dayConfigId,
  });
}
