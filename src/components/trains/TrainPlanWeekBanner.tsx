"use client";

import { useTranslations } from "next-intl";

export function TrainPlanWeekBanner() {
  const t = useTranslations("trains.planWeekBanner");

  return (
    <section
      className="rounded-xl border border-hq-accent/35 bg-hq-accent/10 px-4 py-3"
      data-testid="trains-plan-week-banner"
    >
      <h2 className="text-sm font-semibold text-[#c9d1d9]">{t("title")}</h2>
      <p className="mt-1 text-sm leading-relaxed text-hq-fg-muted">{t("body")}</p>
    </section>
  );
}
