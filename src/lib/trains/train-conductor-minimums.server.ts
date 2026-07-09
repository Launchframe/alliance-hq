import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { fetchHqSeasonVsScoresByMember } from "@/lib/trains/native-scores.server";
import {
  buildMemberQualification,
  evaluationPeriodForTrainDate,
  minimumsEnforcementEnabled,
  normalizeTrainMinimumsSettings,
  type MemberQualificationPayload,
  type TrainConductorMinimumsSettings,
  type TrainMinimumsWindow,
} from "@/lib/trains/train-conductor-minimums.shared";
import { allianceTrainWeekFromRow } from "@/lib/trains/train-week-calendar.shared";
import { loadAllianceRow } from "@/lib/members/game-roster";

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
    settings,
    periodStart: start,
    periodEnd: end,
  });
}
