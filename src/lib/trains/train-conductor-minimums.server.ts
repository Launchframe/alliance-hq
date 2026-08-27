import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import { fetchAllianceVsScoresForEvaluationPeriod } from "@/lib/trains/vs-scores.server";
import {
  buildMemberQualification,
  conductorQualificationGateApplies,
  evaluationPeriodForTrainDate,
  minimumsEnforcementEnabled,
  minimumsSettingsForHqLocalEval,
  normalizeTrainMinimumsSettings,
  type MemberQualificationPayload,
  type TrainConductorMinimumsSettings,
  type TrainMinimumsWindow,
} from "@/lib/trains/train-conductor-minimums.shared";
import { allianceTrainWeekFromRow } from "@/lib/trains/train-week-calendar.shared";
import { loadAllianceRow } from "@/lib/members/game-roster";
import type { PoolType } from "@/lib/trains/types";

export type TrainConductorMinimumsRow = TrainConductorMinimumsSettings & {
  canManage: boolean;
};

export async function loadTrainConductorMinimums(
  allianceId: string,
  canManage: boolean,
): Promise<TrainConductorMinimumsRow> {
  const db = getDb();
  const [row] = await db
    .select({
      minVsPoints: schema.alliances.trainConductorMinVsPoints,
      minDonationPoints: schema.alliances.trainConductorMinDonationPoints,
      leewayPct: schema.alliances.trainConductorMinimumLeewayPct,
      window: schema.alliances.trainConductorMinimumsWindow,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const settings = normalizeTrainMinimumsSettings({
    minVsPoints: row?.minVsPoints ?? null,
    minDonationPoints: row?.minDonationPoints ?? null,
    leewayPct: row?.leewayPct ?? 0,
    window: row?.window ?? "weekly",
  });

  return { ...settings, canManage };
}

export async function saveTrainConductorMinimums(
  allianceId: string,
  input: {
    minVsPoints?: number | null;
    minDonationPoints?: number | null;
    leewayPct?: number;
    window?: TrainMinimumsWindow;
  },
): Promise<TrainConductorMinimumsSettings> {
  const settings = normalizeTrainMinimumsSettings(input);
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      trainConductorMinVsPoints: settings.minVsPoints,
      trainConductorMinDonationPoints: settings.minDonationPoints,
      trainConductorMinimumLeewayPct: settings.leewayPct,
      trainConductorMinimumsWindow: settings.window,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));

  return settings;
}

export async function evaluateConductorQualification(input: {
  allianceId: string;
  memberId: string;
  trainDate: string;
  paintTemplate?: string | null;
  leadDays?: number;
}): Promise<MemberQualificationPayload | null> {
  const settings = await loadTrainConductorMinimums(input.allianceId, false);
  if (!minimumsEnforcementEnabled(settings)) {
    return null;
  }

  const allianceRow = await loadAllianceRow(input.allianceId);
  const trainWeekConfig = allianceTrainWeekFromRow(allianceRow ?? {});
  const leadDays =
    input.leadDays ??
    (await loadAllianceTrainLeadTimeDays(input.allianceId));
  const { start, end } = evaluationPeriodForTrainDate(
    input.trainDate,
    settings.window,
    trainWeekConfig,
    { leadDays, paintTemplate: input.paintTemplate },
  );

  const vsTotals = await fetchAllianceVsScoresForEvaluationPeriod(
    input.allianceId,
    start,
    end,
  );

  return buildMemberQualification({
    vsScore: vsTotals.get(input.memberId) ?? 0,
    donationScore: 0,
    settings: minimumsSettingsForHqLocalEval(settings),
    periodStart: start,
    periodEnd: end,
  });
}

/**
 * When conductor minimums are enabled, returns memberIds that pass.
 * `null` means minimums are off — callers should treat every candidate as eligible.
 */
export async function filterMemberIdsByConductorMinimums(
  allianceId: string,
  trainDate: string,
  memberIds: readonly string[],
  options?: { paintTemplate?: string | null; leadDays?: number },
): Promise<string[] | null> {
  const settings = await loadTrainConductorMinimums(allianceId, false);
  if (!minimumsEnforcementEnabled(settings)) {
    return null;
  }
  if (memberIds.length === 0) {
    return [];
  }

  const allianceRow = await loadAllianceRow(allianceId);
  const trainWeekConfig = allianceTrainWeekFromRow(allianceRow ?? {});
  const leadDays =
    options?.leadDays ?? (await loadAllianceTrainLeadTimeDays(allianceId));
  const { start, end } = evaluationPeriodForTrainDate(
    trainDate,
    settings.window,
    trainWeekConfig,
    { leadDays, paintTemplate: options?.paintTemplate },
  );
  const evalSettings = minimumsSettingsForHqLocalEval(settings);
  const vsTotals = await fetchAllianceVsScoresForEvaluationPeriod(
    allianceId,
    start,
    end,
  );

  return memberIds.filter((memberId) => {
    const qualification = buildMemberQualification({
      vsScore: vsTotals.get(memberId) ?? 0,
      donationScore: 0,
      settings: evalSettings,
      periodStart: start,
      periodEnd: end,
    });
    return qualification.qualified;
  });
}

/**
 * Whether pool seed/reseed should filter candidates by conductor minimums.
 * Matches post-roll DQ gating (prior-day / prior-week Ashed VS totals).
 */
export async function resolvePoolRespectsConductorMinimums(input: {
  allianceId: string;
  poolType: PoolType;
  paintTemplate?: string | null;
}): Promise<boolean> {
  return resolveConductorQualificationGateApplies({
    allianceId: input.allianceId,
    poolType: input.poolType,
    paintTemplate: input.paintTemplate,
  });
}

/** Whether post-roll minimums DQ applies for this conductor wheel spin. */
export async function resolveConductorQualificationGateApplies(input: {
  allianceId: string;
  poolType?: PoolType | null;
  paintTemplate?: string | null;
}): Promise<boolean> {
  const settings = await loadTrainConductorMinimums(input.allianceId, false);
  return conductorQualificationGateApplies({
    poolType: input.poolType,
    minimumsEnabled: minimumsEnforcementEnabled(settings),
    paintTemplate: input.paintTemplate,
  });
}
