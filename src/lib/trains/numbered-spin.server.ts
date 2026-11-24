import "server-only";

import { randomInt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  buildNumberedWheelCandidates,
  numberedSpinCandidateId,
  resolveNumberedSpinPoolSize,
} from "@/lib/trains/numbered-spin.shared";
import {
  getConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import { TrainRollError } from "@/lib/trains/roll-errors.server";
import {
  encodeLegacyConductorMechanism,
  encodeLegacyVipMechanism,
} from "@/lib/trains/rules/encode.shared";
import type { RollResult } from "@/lib/trains/types";

export async function rollNumberedForTrain(input: {
  allianceId: string;
  date: string;
  role: "conductor" | "vip";
  seasonKey: string;
  /** Optional deterministic RNG override for tests (returns integer in 1..poolSize). */
  drawRank?: (poolSize: number) => number;
}): Promise<RollResult> {
  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    input.seasonKey,
  );
  const dayRule =
    input.role === "vip" ? dayConfig.vipRule : dayConfig.conductorRule;
  const poolSize = resolveNumberedSpinPoolSize(dayRule);

  if (poolSize === null) {
    throw new TrainRollError(
      "Numbered spin fallback is only available for Top-N score rules.",
      { code: "NO_WHEEL_CANDIDATES" },
    );
  }

  const rank = input.drawRank
    ? input.drawRank(poolSize)
    : randomInt(1, poolSize + 1);
  if (!Number.isInteger(rank) || rank < 1 || rank > poolSize) {
    throw new Error(`Invalid numbered spin rank ${rank} for pool size ${poolSize}`);
  }

  const existing = await getConductorRecord(input.allianceId, input.date);
  if (input.role === "conductor" && existing?.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  if (input.role === "vip" && existing?.lockedAt) {
    // Allow recording a pending numbered VIP on a locked train when VIP is still unset.
    const db = getDb();
    await db
      .update(schema.trainConductorRecords)
      .set({
        vipNumberedRank: rank,
        vipNumberedPoolSize: poolSize,
        vipRule: dayConfig.vipRule,
        vipMechanism: encodeLegacyVipMechanism(dayConfig.vipRule),
        noVip: 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.trainConductorRecords.id, existing.id),
          isNull(schema.trainConductorRecords.vipMemberId),
        ),
      );
  } else if (input.role === "vip") {
    await upsertConductorDraft({
      allianceId: input.allianceId,
      date: input.date,
      seasonKey: input.seasonKey,
      vipMemberId: null,
      vipMemberName: null,
      vipNumberedRank: rank,
      vipNumberedPoolSize: poolSize,
      vipRule: dayConfig.vipRule,
      vipMechanism: encodeLegacyVipMechanism(dayConfig.vipRule),
      dayConfigId: dayConfig.dayConfigId,
    });
  } else {
    await upsertConductorDraft({
      allianceId: input.allianceId,
      date: input.date,
      seasonKey: input.seasonKey,
      conductorMemberId: null,
      conductorMemberName: null,
      conductorNumberedRank: rank,
      conductorNumberedPoolSize: poolSize,
      conductorRule: dayConfig.conductorRule,
      conductorMechanism: encodeLegacyConductorMechanism(
        dayConfig.conductorRule,
      ),
      dayConfigId: dayConfig.dayConfigId,
    });
  }

  const mechanism =
    input.role === "vip"
      ? encodeLegacyVipMechanism(dayConfig.vipRule)
      : encodeLegacyConductorMechanism(dayConfig.conductorRule);

  return {
    memberId: numberedSpinCandidateId(rank),
    memberName: `#${rank}`,
    mechanism: mechanism as RollResult["mechanism"],
    isAutomatic: false,
    wheelCandidates: buildNumberedWheelCandidates(poolSize),
    draftPersisted: true,
    rule: dayRule,
    numberedRank: rank,
    numberedPoolSize: poolSize,
  };
}
