import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { fetchHqSeasonVsScoresByMember } from "@/lib/trains/native-scores.server";
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
import { classifyVsDataNeed } from "@/lib/trains/vs-data-status.shared";
import { loadTrainsVsDataStatus } from "@/lib/trains/vs-data-status.server";
import type { ConductorMechanismType, PoolType, WeekTemplateType } from "@/lib/trains/types";

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
}): Promise<MemberQualificationPayload | null> {
  const settings = await loadTrainConductorMinimums(input.allianceId, false);
  if (!minimumsEnforcementEnabled(settings)) {
    return null;
  }

  const allianceRow = await loadAllianceRow(input.allianceId);
  const trainWeekConfig = allianceTrainWeekFromRow(allianceRow ?? {});
  const { start, end } = evaluationPeriodForTrainDate(
    input.trainDate,
    settings.window,
    trainWeekConfig,
  );

  // HQ stores season VR totals only (no per-day VS or donation ledger yet).
  const vsTotals = await fetchHqSeasonVsScoresByMember(input.allianceId);

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
): Promise<string[] | null> {
  const settings = await loadTrainConductorMinimums(allianceId, false);
  if (!minimumsEnforcementEnabled(settings)) {
    return null;
  }

  const allianceRow = await loadAllianceRow(allianceId);
  const trainWeekConfig = allianceTrainWeekFromRow(allianceRow ?? {});
  const { start, end } = evaluationPeriodForTrainDate(
    trainDate,
    settings.window,
    trainWeekConfig,
  );
  const evalSettings = minimumsSettingsForHqLocalEval(settings);
  const vsTotals = await fetchHqSeasonVsScoresByMember(allianceId);

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
 * Matches post-roll DQ gating — skip when VS prerequisites are not in play.
 */
export async function resolvePoolRespectsConductorMinimums(input: {
  allianceId: string;
  trainDate: string;
  poolType: PoolType;
  conductorMechanism?: ConductorMechanismType | string | null;
  paintTemplate?: WeekTemplateType | string | null;
}): Promise<boolean> {
  return resolveConductorQualificationGateApplies({
    allianceId: input.allianceId,
    trainDate: input.trainDate,
    conductorMechanism: input.conductorMechanism ?? "",
    paintTemplate: input.paintTemplate,
    poolType: input.poolType,
  });
}

/** Whether post-roll minimums DQ applies for this conductor wheel spin. */
export async function resolveConductorQualificationGateApplies(input: {
  allianceId: string;
  trainDate: string;
  conductorMechanism: ConductorMechanismType | string;
  paintTemplate?: WeekTemplateType | string | null;
  poolType?: PoolType | null;
}): Promise<boolean> {
  const settings = await loadTrainConductorMinimums(input.allianceId, false);
  const need = classifyVsDataNeed({
    conductorMechanism: input.conductorMechanism,
    paintTemplate: input.paintTemplate,
    trainDate: input.trainDate,
  });
  const vsStatus =
    need.required === false
      ? { required: false, ready: true }
      : await loadTrainsVsDataStatus({
          allianceId: input.allianceId,
          trainDate: input.trainDate,
          conductorMechanism: input.conductorMechanism,
          paintTemplate: input.paintTemplate,
        });

  return conductorQualificationGateApplies({
    poolType: input.poolType,
    minimumsEnabled: minimumsEnforcementEnabled(settings),
    vsDataRequired: vsStatus.required,
    vsDataReady: vsStatus.ready,
  });
}
