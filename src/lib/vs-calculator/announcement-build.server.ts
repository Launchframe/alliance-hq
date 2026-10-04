import "server-only";

import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { formatVsDailyAnnouncementMessage } from "@/lib/vs-calculator/announcement-message.shared";
import { topEarnPointLinesForDay } from "@/lib/vs-calculator/capacity.shared";
import type { VsCatalogItemDef } from "@/lib/vs-calculator/capacity.shared";
import { listActiveVsCatalogDefs } from "@/lib/vs-calculator/inventory.server";
import { resolveShinyWeekdaysForAlliance } from "@/lib/vs-calculator/shiny-sync.server";
import { tVsAnnouncement } from "@/lib/vs-calculator/vs-announcements-i18n.shared";
import { isCalculatorDay } from "@/lib/vs-calculator/vs-calculator.shared";
import { vsMatchDayNumberFromDate } from "@/lib/vs-calculator/vs-calendar.shared";
import {
  getBusterDayReminderHintKeys,
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
  let earnPointLines: string[] | undefined;
  let reminderLines: string[] | undefined;

  if (isCalculatorDay(targetVsDay)) {
    earnPointLines = topEarnPointLinesForDay(targetVsDay, catalog);
  } else if (targetVsDay === 6) {
    // Buster Day (Saturday): no earn-points catalog. Reminder is computed
    // against targetDate (the announcement's Saturday), not `today` (the cron
    // run date) — officers need shiny status for the day being announced.
    const busterHints = shinyWeekdays
      ? getBusterDayReminderHintKeys(shinyWeekdays, targetDate)
      : [];
    reminderLines = [
      tVsAnnouncement(locale, "reminders.busterDayShinyReminder"),
      ...busterHints.map((key) => tVsAnnouncement(locale, `saveHints.${key}`)),
    ];
  } else {
    // Sunday rest day: look ahead to Monday's Radar Training past the break.
    reminderLines = [
      tVsAnnouncement(locale, "reminders.restDayShinyReminder"),
      tVsAnnouncement(locale, "saveHints.saveRadarForMonday"),
      tVsAnnouncement(locale, "reminders.gatherBeforeReset"),
    ];
  }

  const message = formatVsDailyAnnouncementMessage({
    locale,
    targetDate,
    radarSaveHint,
    shinySaveHints,
    earnPointLines,
    reminderLines,
    calculatorUrl: buildDiscordBotAppUrl(locale, "/tools/vs-calculator"),
  });

  return { targetDate, message };
}
