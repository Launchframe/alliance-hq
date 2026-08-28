import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getWeekSchedule } from "@/lib/trains/repository";
import { PRICE_IS_RIGHT_MIN_VS_SCORE } from "@/lib/trains/train-economy-threshold.shared";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
} from "@/lib/trains/train-week-calendar.shared";
import { resolvePaintTemplateForDay } from "@/lib/trains/week-template-registry.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

const TPIF_TEMPLATES = new Set<WeekTemplateType>([
  "price_is_right",
  "price_is_right_weekdays",
]);

export type HeroDayPlannerTargetContext = {
  tpifMode: boolean;
  defaultTargetScore: number | null;
  trainTemplateType: WeekTemplateType | null;
};

export async function resolveHeroDayPlannerTarget(input: {
  allianceId: string;
  pinnedDate: string;
  pinnedDay: number | null;
}): Promise<HeroDayPlannerTargetContext> {
  if (input.pinnedDay !== 4) {
    return {
      tpifMode: false,
      defaultTargetScore: null,
      trainTemplateType: null,
    };
  }

  const db = getDb();
  const [alliance] = await db
    .select({ trainWeekStartDow: schema.alliances.trainWeekStartDow })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  const trainWeekConfig = allianceTrainWeekFromRow(alliance ?? {});
  const weekStart = getTrainWeekStart(input.pinnedDate, trainWeekConfig);
  const schedule = await getWeekSchedule(input.allianceId, weekStart);
  if (!schedule) {
    return {
      tpifMode: false,
      defaultTargetScore: null,
      trainTemplateType: null,
    };
  }

  const templateType = schedule.templateType as WeekTemplateType;
  const daySegment = resolvePaintTemplateForDay(
    templateType,
    input.pinnedDate,
    weekStart,
  );
  const tpifMode =
    TPIF_TEMPLATES.has(templateType) || TPIF_TEMPLATES.has(daySegment);

  return {
    tpifMode,
    defaultTargetScore: tpifMode ? PRICE_IS_RIGHT_MIN_VS_SCORE : null,
    trainTemplateType: templateType,
  };
}
