import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { VS_WEEK_DAY_MESSAGE_KEYS } from "@/lib/trains/vs-week-days.shared";
import { tVsAnnouncement } from "@/lib/vs-calculator/vs-announcements-i18n.shared";
import type { RadarSaveHintKey, ShinySaveHintKey } from "@/lib/vs-calculator/vs-save-intelligence.shared";
import {
  vsDayMessageKey,
  vsMatchDayNumberFromDate,
  type VsMatchDayNumber,
} from "@/lib/vs-calculator/vs-calendar.shared";

export type VsAnnouncementMessageInput = {
  locale?: DiscordBotLocale;
  targetDate: string;
  radarSaveHint: RadarSaveHintKey | null;
  shinySaveHints: ShinySaveHintKey[];
  earnPointLines?: string[];
  calculatorUrl: string;
};

function dayThemeLabel(
  locale: DiscordBotLocale,
  dayNumber: VsMatchDayNumber,
): string {
  const key = vsDayMessageKey(dayNumber);
  return tVsAnnouncement(locale, `vsWeekDays.${key}`);
}

export function formatVsDailyAnnouncementMessage(
  input: VsAnnouncementMessageInput,
): string {
  const locale = input.locale ?? "en-US";
  const vsDay = vsMatchDayNumberFromDate(input.targetDate);
  const lines: string[] = [];

  if (vsDay == null) {
    lines.push(tVsAnnouncement(locale, "restDayHeader", { date: input.targetDate }));
  } else {
    const theme = dayThemeLabel(locale, vsDay);
    lines.push(
      tVsAnnouncement(locale, "matchDayHeader", {
        date: input.targetDate,
        day: vsDay,
        theme,
      }),
    );
  }

  if (input.earnPointLines && input.earnPointLines.length > 0) {
    lines.push("");
    lines.push(tVsAnnouncement(locale, "earnPointsHeading"));
    for (const line of input.earnPointLines) {
      lines.push(`• ${line}`);
    }
  }

  const saveLines: string[] = [];
  if (input.radarSaveHint) {
    saveLines.push(tVsAnnouncement(locale, `saveHints.${input.radarSaveHint}`));
  }
  for (const hint of input.shinySaveHints) {
    saveLines.push(tVsAnnouncement(locale, `saveHints.${hint}`));
  }

  if (saveLines.length > 0) {
    lines.push("");
    lines.push(tVsAnnouncement(locale, "saveHeading"));
    for (const line of saveLines) {
      lines.push(`• ${line}`);
    }
  }

  lines.push("");
  lines.push(tVsAnnouncement(locale, "footer", { url: input.calculatorUrl }));

  return lines.join("\n");
}

/** Theme key for a VS match day (for reuse in calculator UI). */
export function vsWeekDayThemeKey(dayNumber: VsMatchDayNumber): string {
  return VS_WEEK_DAY_MESSAGE_KEYS[dayNumber];
}
