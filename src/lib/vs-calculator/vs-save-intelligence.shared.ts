import { addCalendarDays, getServerDayOfWeek } from "@/lib/trains/game-time";

import {
  daysUntilNextShinySpawn,
  isShinySpawnWeekday,
} from "@/lib/vs-calculator/shiny-schedule.shared";

export type RadarSaveHintKey =
  | "saveRadarForMonday"
  | "saveRadarForWednesday"
  | "saveRadarForFriday";

const RADAR_SAVE_BY_DOW: Partial<Record<number, RadarSaveHintKey>> = {
  0: "saveRadarForMonday",
  2: "saveRadarForWednesday",
  4: "saveRadarForFriday",
};

export function getRadarSaveHintKey(
  serverDate: string,
): RadarSaveHintKey | null {
  const dow = getServerDayOfWeek(serverDate);
  return RADAR_SAVE_BY_DOW[dow] ?? null;
}

export type ShinySaveHintKey =
  | "shinySpawnToday"
  | "shinySpawnTomorrow"
  | "saveShinyForTuesday"
  | "saveShinyForSaturday"
  | "shinyRolloverTuesday"
  | "shinyRolloverSaturday";

export function getShinySaveHintKeys(
  shinyWeekdays: [number, number],
  serverDate: string,
): ShinySaveHintKey[] {
  const dow = getServerDayOfWeek(serverDate);
  const hints: ShinySaveHintKey[] = [];
  const daysUntil = daysUntilNextShinySpawn(shinyWeekdays, dow);

  if (daysUntil === 0) {
    hints.push("shinySpawnToday");
  } else if (daysUntil === 1) {
    hints.push("shinySpawnTomorrow");
  }

  const tomorrowDow = getServerDayOfWeek(addCalendarDays(serverDate, 1));
  if (tomorrowDow === 2 && isShinySpawnWeekday(shinyWeekdays, tomorrowDow)) {
    hints.push("shinyRolloverTuesday");
  }

  if (dow === 2 && isShinySpawnWeekday(shinyWeekdays, dow)) {
    hints.push("shinyRolloverTuesday");
  }

  const daysUntilSaturday = (6 - dow + 7) % 7;
  if (
    daysUntilSaturday > 0 &&
    daysUntilSaturday <= 3 &&
    (isShinySpawnWeekday(shinyWeekdays, dow) || daysUntil <= daysUntilSaturday)
  ) {
    hints.push("saveShinyForSaturday");
  }

  const daysUntilTuesday = (2 - dow + 7) % 7;
  if (
    daysUntilTuesday > 0 &&
    daysUntilTuesday <= 3 &&
    (isShinySpawnWeekday(shinyWeekdays, dow) || daysUntil <= daysUntilTuesday)
  ) {
    hints.push("saveShinyForTuesday");
  }

  return [...new Set(hints)];
}

export function getWeeklySaveHintKeysForDow(
  shinyWeekdays: [number, number],
  dow: number,
): Array<RadarSaveHintKey | ShinySaveHintKey> {
  const dateForDow = "2024-01-07";
  const offset = (dow - getServerDayOfWeek(dateForDow) + 7) % 7;
  const serverDate = addCalendarDays(dateForDow, offset);
  const radar = getRadarSaveHintKey(serverDate);
  const shiny = getShinySaveHintKeys(shinyWeekdays, serverDate);
  return radar ? [radar, ...shiny] : shiny;
}
