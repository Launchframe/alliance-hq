import type { DiscordTranslate } from "@/lib/discord/i18n";
import {
  formatGrowthWindowLabel,
  formatKillsPerHour,
  resolveStatGrowth,
  type StatGrowthContext,
} from "@/lib/discord/stat-growth-reply.shared";
import { formatKillsTotalForDiscord } from "@/lib/kills/format.shared";

function windowLabel(
  t: DiscordTranslate,
  window: NonNullable<ReturnType<typeof resolveStatGrowth>["window"]>,
): string {
  const key = window.preferHours
    ? window.hours === 1
      ? "kills.windowHour"
      : "kills.windowHours"
    : window.days === 1
      ? "kills.windowDay"
      : "kills.windowDays";
  const count = window.preferHours ? window.hours : window.days;
  const localized = t(key, { count });
  if (localized !== key) {
    return localized;
  }
  return formatGrowthWindowLabel(window);
}

/** Discord success reply for /kills (growth + kph when prior report exists). */
export function buildKillsDiscordSuccessReply(
  t: DiscordTranslate,
  input: StatGrowthContext,
): string {
  const name = input.commanderName.trim() || "Commander";
  const total = formatKillsTotalForDiscord(input.total);
  const growth = resolveStatGrowth(input);

  if (growth.delta == null || growth.window == null || growth.hoursForRate == null) {
    return t("kills.successFirst", { name, total });
  }

  return t("kills.success", {
    name,
    total,
    delta: formatKillsTotalForDiscord(growth.delta),
    window: windowLabel(t, growth.window),
    kph: formatKillsPerHour(growth.delta, growth.hoursForRate),
  });
}
