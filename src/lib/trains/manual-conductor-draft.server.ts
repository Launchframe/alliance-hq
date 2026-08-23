import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { withConductorPoolClaimLock } from "@/lib/trains/conductor-pool-claim-lock.server";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import {
  ManualPickEligibilityError,
  depletingManualPickErrorMessage,
  evaluateDepletingManualPick,
  officerConfirmedManualPickOverride,
  rankIneligibleManualPickMessage,
  shouldReleasePriorPoolSelection,
} from "@/lib/trains/depleting-manual-pick.shared";
import { usesPriceIsFreightConductorRoll } from "@/lib/trains/heavy-hitter-pool.shared";
import {
  listPoolEntries,
  listUnselectedPoolEntries,
  markPoolMemberSelectedForDate,
  releasePoolSelectionForDate,
} from "@/lib/trains/pool";
import {
  getMemberRankAsOf,
  memberIdsEligibleForPoolType,
} from "@/lib/trains/rank-history";
import type { PoolType } from "@/lib/trains/types";
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
  /** Officer confirmed assigning a member outside this day's eligibility. */
  allowEligibilityOverride?: boolean;
  /** @deprecated alias of allowEligibilityOverride */
  allowSameGenerationReuse?: boolean;
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
  const mechanism =
    effectiveConductorMechanism(
      dayConfig.conductorMechanism,
      dayConfig.paintTemplate,
      input.date,
    ) ?? dayConfig.conductorMechanism;
  if (!supportsManualConductorPick(mechanism)) {
    throw new Error("Manual conductor pick is not allowed for this day.");
  }

  const depletingPool =
    !usesPriceIsFreightConductorRoll(dayConfig.paintTemplate) &&
    Boolean(conductorMechanismPoolType(mechanism));

  const rankEvent = await getMemberRankAsOf(
    input.allianceId,
    input.memberId,
    input.date,
  );

  const poolType: PoolType | null = depletingPool
    ? conductorMechanismPoolType(mechanism)
    : null;
  const overrideConfirmed = officerConfirmedManualPickOverride(input);

  if (poolType === "r3" || poolType === "r4_plus") {
    const eligible = await memberIdsEligibleForPoolType(
      input.allianceId,
      poolType,
      input.date,
      [input.memberId],
    );
    if (!eligible.has(input.memberId) && !overrideConfirmed) {
      throw new ManualPickEligibilityError(
        "rank_ineligible",
        rankIneligibleManualPickMessage(poolType),
      );
    }
  }
  const priorConductorMemberId = existing?.conductorMemberId ?? null;
  if (poolType) {
    const replacingSameMember = priorConductorMemberId === input.memberId;
    if (!replacingSameMember) {
      await ensureConductorPoolSeeded({
        hqAllianceId: input.allianceId,
        poolType,
        date: input.date,
        useSequence: mechanism === "r4_sequence",
        paintTemplate: dayConfig.paintTemplate,
        respectConductorMinimums: false,
      });
      await withConductorPoolClaimLock(
        { allianceId: input.allianceId, poolType },
        async () => {
          const [unselected, poolEntries] = await Promise.all([
            listUnselectedPoolEntries(input.allianceId, poolType),
            listPoolEntries(input.allianceId, poolType),
          ]);
          const gate = evaluateDepletingManualPick({
            memberId: input.memberId,
            unselectedMemberIds: unselected.map((row) => row.memberId),
            poolMemberIds: poolEntries.map((row) => row.memberId),
          });
          if (gate.ok) {
            const claimed = await markPoolMemberSelectedForDate(
              input.allianceId,
              poolType,
              input.memberId,
              input.date,
            );
            if (!claimed) {
              throw new ManualPickEligibilityError(
                "already_awarded",
                depletingManualPickErrorMessage("already_awarded"),
              );
            }
          } else if (overrideConfirmed) {
            // Officer confirmed: draft without consuming or refreshing the
            // generation. Already-chosen / missing rows stay as-is so the
            // wheel cannot land on a spent or newly inserted slot.
          } else {
            throw new ManualPickEligibilityError(
              gate.reason,
              depletingManualPickErrorMessage(gate.reason),
            );
          }
        },
      );
    }
  }

  const record = await upsertConductorDraft({
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

  if (
    poolType &&
    shouldReleasePriorPoolSelection({
      previousMemberId: priorConductorMemberId,
      nextMemberId: input.memberId,
    })
  ) {
    await releasePoolSelectionForDate(
      input.allianceId,
      input.date,
      priorConductorMemberId!,
    );
  }

  return record;
}
