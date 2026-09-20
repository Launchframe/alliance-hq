import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { TrainTopScoreEligibilitySettings } from "@/lib/trains/train-top-score-eligibility.shared";

export type TrainTopScoreEligibilityRow =
  TrainTopScoreEligibilitySettings & { canManage: boolean };

export async function loadTrainTopScoreEligibility(
  allianceId: string,
  canManage: boolean,
): Promise<TrainTopScoreEligibilityRow> {
  const db = getDb();
  const [row] = await db
    .select({
      includesR4Plus: schema.alliances.trainTopScoreIncludesR4Plus,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return {
    trainTopScoreIncludesR4Plus: (row?.includesR4Plus ?? 1) !== 0,
    canManage,
  };
}

export async function saveTrainTopScoreEligibility(
  allianceId: string,
  input: TrainTopScoreEligibilitySettings,
): Promise<TrainTopScoreEligibilitySettings> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      trainTopScoreIncludesR4Plus: input.trainTopScoreIncludesR4Plus ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));

  return {
    trainTopScoreIncludesR4Plus: input.trainTopScoreIncludesR4Plus,
  };
}
