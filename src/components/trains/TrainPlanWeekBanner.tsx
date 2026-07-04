"use client";

import { useTranslations } from "next-intl";

export function TrainPlanWeekBanner() {
  const t = useTranslations("trains.planWeekBanner");

  return (
    <section
      className="rounded-xl border border-[#58a6ff]/35 bg-[#58a6ff]/10 px-4 py-3"
      data-testid="trains-plan-week-banner"
    >
      <h2 className="text-sm font-semibold text-[#c9d1d9]">{t("title")}</h2>
      <p className="mt-1 text-sm leading-relaxed text-[#8b949e]">{t("body")}</p>
    </section>
  );
}
