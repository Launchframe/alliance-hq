import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  normalizeTrainTopScoreMinimumRank,
  type TrainTopScoreEligibilitySettings,
} from "@/lib/trains/train-top-score-eligibility.shared";

export type TrainTopScoreEligibilityRow =
  TrainTopScoreEligibilitySettings & { canManage: boolean };

export async function loadTrainTopScoreEligibility(
  allianceId: string,
  canManage: boolean,
): Promise<TrainTopScoreEligibilityRow> {
  const db = getDb();
  const [row] = await db
    .select({
      minRank: schema.alliances.trainTopScoreMinRank,
      includesR4Plus: schema.alliances.trainTopScoreIncludesR4Plus,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return {
    trainTopScoreMinRank: normalizeTrainTopScoreMinimumRank(row?.minRank),
    trainTopScoreIncludesR4Plus: (row?.includesR4Plus ?? 1) !== 0,
    canManage,
  };
}

export async function saveTrainTopScoreEligibility(
  allianceId: string,
  input: TrainTopScoreEligibilitySettings,
): Promise<TrainTopScoreEligibilitySettings> {
  const settings: TrainTopScoreEligibilitySettings = {
    trainTopScoreMinRank: normalizeTrainTopScoreMinimumRank(
      input.trainTopScoreMinRank,
    ),
    trainTopScoreIncludesR4Plus: input.trainTopScoreIncludesR4Plus,
  };
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      trainTopScoreMinRank: settings.trainTopScoreMinRank,
      trainTopScoreIncludesR4Plus: settings.trainTopScoreIncludesR4Plus ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));

  return settings;
}
