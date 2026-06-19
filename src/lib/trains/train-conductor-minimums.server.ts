import "server-only";

import { eq } from "drizzle-orm";

import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import { fetchDonationTotalsForDateRange } from "@/lib/trains/donation-scores.server";
import {
  buildMemberQualification,
  evaluationPeriodForTrainDate,
  minimumsEnforcementEnabled,
  normalizeTrainMinimumsSettings,
  type MemberQualificationPayload,
  type TrainConductorMinimumsSettings,
  type TrainMinimumsWindow,
} from "@/lib/trains/train-conductor-minimums.shared";
import { fetchVsTotalsForDateRange } from "@/lib/trains/vs-scores.server";

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
  connection: ParsedConnection | null;
  ashedAllianceId: string;
}): Promise<MemberQualificationPayload | null> {
  const settings = await loadTrainConductorMinimums(input.allianceId, false);
  if (!minimumsEnforcementEnabled(settings)) {
    return null;
  }
  if (!input.connection) {
    return null;
  }

  const { start, end } = evaluationPeriodForTrainDate(
    input.trainDate,
    settings.window,
  );

  const [vsTotals, donationTotals] = await Promise.all([
    fetchVsTotalsForDateRange(
      input.connection,
      input.ashedAllianceId,
      start,
      end,
    ),
    fetchDonationTotalsForDateRange(
      input.connection,
      input.ashedAllianceId,
      start,
      end,
    ),
  ]);

  return buildMemberQualification({
    vsScore: vsTotals.get(input.memberId) ?? 0,
    donationScore: donationTotals.get(input.memberId) ?? 0,
    settings,
    periodStart: start,
    periodEnd: end,
  });
}
