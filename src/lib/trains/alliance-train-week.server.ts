import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  allianceTrainWeekFromRow,
  DEFAULT_ALLIANCE_TRAIN_WEEK,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";

export type AllianceTrainWeekSettings = AllianceTrainWeekConfig & {
  canManage: boolean;
};

export async function loadAllianceTrainWeekSettings(
  allianceId: string,
  canManage: boolean,
): Promise<AllianceTrainWeekSettings> {
  const db = getDb();
  const [row] = await db
    .select({ trainWeekStartDow: schema.alliances.trainWeekStartDow })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return {
    ...allianceTrainWeekFromRow(row ?? {}),
    canManage,
  };
}

export async function saveAllianceTrainWeekStartDow(
  allianceId: string,
  trainWeekStartDow: number,
): Promise<AllianceTrainWeekConfig> {
  const normalized =
    Number.isInteger(trainWeekStartDow) &&
    trainWeekStartDow >= 0 &&
    trainWeekStartDow <= 6
      ? trainWeekStartDow
      : DEFAULT_ALLIANCE_TRAIN_WEEK.trainWeekStartDow;

  const db = getDb();
  await db
    .update(schema.alliances)
    .set({ trainWeekStartDow: normalized, updatedAt: new Date() })
    .where(eq(schema.alliances.id, allianceId));

  return { trainWeekStartDow: normalized };
}
