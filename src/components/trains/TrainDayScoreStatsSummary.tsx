"use client";

import { useLocale, useTranslations } from "next-intl";

import type { TrainDayScoreStats } from "@/lib/trains/day-score-stats.shared";

type Props = {
  stats: TrainDayScoreStats;
  /** Compact for week tiles; full for Simple/Advanced panels. */
  variant?: "compact" | "full";
  className?: string;
};

function formatScoreWeekday(scoreDate: string, locale: string): string {
  return new Date(`${scoreDate}T12:00:00-02:00`).toLocaleDateString(locale, {
    weekday: "long",
    timeZone: "Etc/GMT+2",
  });
}

export function TrainDayScoreStatsSummary({
  stats,
  variant = "full",
  className = "",
}: Props) {
  const t = useTranslations("trains.dayScoreStats");
  const tPool = useTranslations("trains.poolDetails");
  const locale = useLocale();

  const vsDayName =
    stats.kind === "prior_day_vs" && stats.vsDayKey
      ? tPool(
          `vsWeekDays.${stats.vsDayKey}` as
            | "vsWeekDays.radarTraining"
            | "vsWeekDays.baseExpansion"
            | "vsWeekDays.ageOfScience"
            | "vsWeekDays.heroDay"
            | "vsWeekDays.totalMobilization"
            | "vsWeekDays.busterDay",
        )
      : null;
  const weekday =
    stats.kind === "prior_day_vs" && stats.scoreDate
      ? formatScoreWeekday(stats.scoreDate, locale)
      : null;

  if (variant === "compact") {
    const parts: string[] = [];
    if (vsDayName) parts.push(vsDayName);
    else if (stats.kind === "vr") parts.push(t("vrLabel"));
    if (weekday) parts.push(weekday);
    parts.push(t("considered", { count: stats.scoreCount }));
    parts.push(t("eligible", { count: stats.eligibleCount }));
    return (
      <div
        className={`truncate text-[9px] leading-tight text-hq-fg-muted ${className}`}
        data-testid="trains-day-score-stats"
        title={parts.join(" · ")}
      >
        {parts.join(" · ")}
      </div>
    );
  }

  if (stats.kind === "vr") {
    return (
      <p
        className={`text-sm text-hq-fg-muted ${className}`}
        data-testid="trains-day-score-stats"
      >
        {t("vrSummary", {
          considered: stats.scoreCount,
          eligible: stats.eligibleCount,
        })}
      </p>
    );
  }

  return (
    <p
      className={`text-sm text-hq-fg-muted ${className}`}
      data-testid="trains-day-score-stats"
    >
      {t("summary", {
        vsDay: vsDayName ?? t("vsDayUnknown"),
        weekday: weekday ?? "—",
        considered: stats.scoreCount,
        eligible: stats.eligibleCount,
      })}
    </p>
  );
}
