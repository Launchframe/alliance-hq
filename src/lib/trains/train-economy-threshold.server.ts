import "server-only";

import { eq } from "drizzle-orm";

import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import type { RollCandidate } from "@/lib/trains/types";
import {
  economyThresholdEnforcementEnabled,
  isVsScoreEconomyEligible,
  normalizeTrainEconomyThresholdSettings,
  type TrainEconomyThresholdSettings,
} from "@/lib/trains/train-economy-threshold.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import { fetchVsScoresByRecordedDate } from "@/lib/trains/vs-scores.server";

export type TrainEconomyThresholdRow = TrainEconomyThresholdSettings & {
  canManage: boolean;
};

export async function loadTrainEconomyThreshold(
  allianceId: string,
  canManage: boolean,
): Promise<TrainEconomyThresholdRow> {
  const db = getDb();
  const [row] = await db
    .select({
      thresholdPoints: schema.alliances.trainEconomyThresholdPoints,
      fudgePct: schema.alliances.trainEconomyThresholdFudgePct,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const settings = normalizeTrainEconomyThresholdSettings({
    thresholdPoints: row?.thresholdPoints ?? null,
    fudgePct: row?.fudgePct ?? 1,
  });

  return { ...settings, canManage };
}

export async function saveTrainEconomyThreshold(
  allianceId: string,
  input: {
    thresholdPoints?: number | null;
    fudgePct?: number;
  },
): Promise<TrainEconomyThresholdSettings> {
  const settings = normalizeTrainEconomyThresholdSettings(input);
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      trainEconomyThresholdPoints: settings.thresholdPoints,
      trainEconomyThresholdFudgePct: settings.fudgePct,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));

  return settings;
}

export async function filterPoolByEconomyThreshold(input: {
  allianceId: string;
  trainDate: string;
  connection: ParsedConnection | null;
  ashedAllianceId: string;
  candidates: RollCandidate[];
  settings?: TrainEconomyThresholdSettings;
}): Promise<RollCandidate[]> {
  const settings =
    input.settings ??
    (await loadTrainEconomyThreshold(input.allianceId, false));
  if (!economyThresholdEnforcementEnabled(settings)) {
    return input.candidates;
  }

  const threshold = settings.thresholdPoints!;
  const scoreDate = vsScoreReferenceDate(input.trainDate);
  let vsScores = new Map<string, number>();

  if (input.connection) {
    vsScores = await fetchVsScoresByRecordedDate(
      input.connection,
      input.ashedAllianceId,
      scoreDate,
    );
  }

  return input.candidates.filter((candidate) =>
    isVsScoreEconomyEligible(
      vsScores.get(candidate.memberId) ?? 0,
      threshold,
      settings.fudgePct,
    ),
  );
}
