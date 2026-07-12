import type { DiscordTranslate } from "@/lib/discord/i18n";
import {
  resolveStatGrowth,
  type StatGrowthContext,
} from "@/lib/discord/stat-growth-reply.shared";
import { formatThpTotalForDiscord } from "@/lib/thp/format.shared";

function daysWindowLabel(t: DiscordTranslate, days: number): string {
  const key = days === 1 ? "thp.windowDay" : "thp.windowDays";
  const localized = t(key, { count: days });
  if (localized !== key) {
    return localized;
  }
  return days === 1 ? "1 day" : `${days} days`;
}

/** Discord success reply for /thp (growth when prior report exists). */
export function buildThpDiscordSuccessReply(
  t: DiscordTranslate,
  input: StatGrowthContext,
): string {
  const name = input.commanderName.trim() || "Commander";
  const total = formatThpTotalForDiscord(input.total);
  const growth = resolveStatGrowth(input);

  if (growth.delta == null || growth.window == null) {
    return t("thp.successFirst", { name, total });
  }

  return t("thp.success", {
    name,
    total,
    delta: formatThpTotalForDiscord(growth.delta),
    window: daysWindowLabel(t, growth.window.days),
  });
}
