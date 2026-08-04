import "server-only";

import { discordBotAppOrigin } from "@/lib/discord/app-url.shared";
import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { formatVsDailyAnnouncementMessage } from "@/lib/vs-calculator/announcement-message.shared";
import { topEarnPointLinesForDay } from "@/lib/vs-calculator/capacity.shared";
import type { VsCatalogItemDef } from "@/lib/vs-calculator/capacity.shared";
import { listActiveVsCatalogDefs } from "@/lib/vs-calculator/inventory.server";
import { resolveShinyWeekdaysForAlliance } from "@/lib/vs-calculator/shiny-sync.server";
import { isCalculatorDay } from "@/lib/vs-calculator/vs-calculator.shared";
import { vsMatchDayNumberFromDate } from "@/lib/vs-calculator/vs-calendar.shared";
import {
  getRadarSaveHintKey,
  getShinySaveHintKeys,
} from "@/lib/vs-calculator/vs-save-intelligence.shared";

export type VsDailyAnnouncementPreview = {
  targetDate: string;
  message: string;
};

export async function buildVsDailyAnnouncementPreview(input: {
  allianceId: string;
  locale?: DiscordBotLocale;
  now?: Date;
  catalog?: VsCatalogItemDef[];
}): Promise<VsDailyAnnouncementPreview> {
  const locale = input.locale ?? "en-US";
  const today = getServerCalendarDate(input.now);
  const targetDate = addCalendarDays(today, 1);
  const catalog = input.catalog ?? (await listActiveVsCatalogDefs());

  const shinyWeekdays = await resolveShinyWeekdaysForAlliance(input.allianceId);
  const radarSaveHint = getRadarSaveHintKey(today);
  const shinySaveHints =
    shinyWeekdays != null ? getShinySaveHintKeys(shinyWeekdays, today) : [];

  const targetVsDay = vsMatchDayNumberFromDate(targetDate);
  const earnPointLines = isCalculatorDay(targetVsDay)
    ? topEarnPointLinesForDay(targetVsDay, catalog)
    : undefined;

  const message = formatVsDailyAnnouncementMessage({
    locale,
    targetDate,
    radarSaveHint,
    shinySaveHints,
    earnPointLines,
    calculatorUrl: `${discordBotAppOrigin()}/tools/vs-calculator`,
  });

  return { targetDate, message };
}
