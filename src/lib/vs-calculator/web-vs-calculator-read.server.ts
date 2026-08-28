import "server-only";

import { normalizeDiscordBotLocale } from "@/lib/discord/i18n";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import {
  catalogDefsForDay,
  sumCapacityForDay,
} from "@/lib/vs-calculator/capacity.shared";
import {
  getCommanderVsInventory,
  listActiveVsCatalogDefs,
  loadShinyWeekdaysForAlliance,
  resolveCommanderForVsCalculator,
} from "@/lib/vs-calculator/inventory.server";
import type { VsCalculatorPayload } from "@/lib/vs-calculator/vs-calculator.shared";
import { isCalculatorDay } from "@/lib/vs-calculator/vs-calculator.shared";
import {
  VS_CALCULATOR_DAY_NUMBERS,
  vsMatchDayNumberFromDate,
  type VsCalculatorDayNumber,
} from "@/lib/vs-calculator/vs-calendar.shared";
import { buildVsDailyAnnouncementPreview } from "@/lib/vs-calculator/announcement-build.server";
import { resolveHeroDayPlannerTarget } from "@/lib/vs-calculator/hero-day-target.server";
import {
  getCommanderVsPushProfile,
} from "@/lib/vs-calculator/push-profile.server";
import {
  getRadarSaveHintKey,
  getShinySaveHintKeys,
} from "@/lib/vs-calculator/vs-save-intelligence.shared";
import { VS_WEEK_DAY_MESSAGE_KEYS } from "@/lib/trains/vs-week-days.shared";
import { dateForVsMatchDayInWeek, mondayOfVsWeekContaining } from "@/lib/vs-calculator/vs-calendar.shared";

function resolvePinnedDate(
  queryDate: string | null | undefined,
  now = new Date(),
): string {
  const today = getServerCalendarDate(now);
  if (!queryDate?.trim()) return today;
  return /^\d{4}-\d{2}-\d{2}$/.test(queryDate.trim()) ? queryDate.trim() : today;
}

export async function loadVsCalculatorForUser(input: {
  allianceId: string;
  hqUserId: string;
  pinnedDate?: string | null;
  locale?: string;
}): Promise<VsCalculatorPayload | null> {
  const commanderId = await resolveCommanderForVsCalculator(input);
  if (!commanderId) return null;

  const pinnedDate = resolvePinnedDate(input.pinnedDate);
  const pinnedDay = vsMatchDayNumberFromDate(pinnedDate);

  const [catalog, quantities, shinyWeekdays, pushProfile, plannerTarget] =
    await Promise.all([
      listActiveVsCatalogDefs(),
      getCommanderVsInventory(commanderId),
      loadShinyWeekdaysForAlliance(input.allianceId),
      getCommanderVsPushProfile(commanderId),
      resolveHeroDayPlannerTarget({
        allianceId: input.allianceId,
        pinnedDate,
        pinnedDay,
      }),
    ]);

  const dayTotal =
    isCalculatorDay(pinnedDay)
      ? sumCapacityForDay(pinnedDay, quantities, catalog)
      : 0;

  const weekMonday = mondayOfVsWeekContaining(pinnedDate);
  const weekly = VS_CALCULATOR_DAY_NUMBERS.map((day) => {
    const date = dateForVsMatchDayInWeek(weekMonday, day);
    const radarKey = getRadarSaveHintKey(addCalendarDays(date, -1));
    const shinyKeys =
      shinyWeekdays != null
        ? getShinySaveHintKeys(shinyWeekdays, addCalendarDays(date, -1))
        : [];
    return {
      day,
      themeKey: VS_WEEK_DAY_MESSAGE_KEYS[day],
      totalPoints: sumCapacityForDay(day, quantities, catalog),
      saveHints: {
        radar: radarKey,
        shiny: shinyKeys,
      },
    };
  });

  const botLocale = normalizeDiscordBotLocale(input.locale);
  const announcementPreview = await buildVsDailyAnnouncementPreview({
    allianceId: input.allianceId,
    locale: botLocale,
    catalog,
  });

  return {
    commanderId,
    pinnedDate,
    pinnedDay,
    quantities,
    catalog,
    dayTotal,
    weekly,
    shinyWeekdays,
    announcementPreview,
    planner:
      pinnedDay === 4
        ? {
            enabled: true,
            tpifMode: plannerTarget.tpifMode,
            defaultTargetScore: plannerTarget.defaultTargetScore,
            pushProfile,
          }
        : undefined,
  };
}

export function catalogDefsForPinnedDay(
  pinnedDay: VsCalculatorDayNumber | null,
  catalog: VsCalculatorPayload["catalog"],
) {
  if (pinnedDay == null) return [];
  return catalogDefsForDay(pinnedDay, catalog);
}
