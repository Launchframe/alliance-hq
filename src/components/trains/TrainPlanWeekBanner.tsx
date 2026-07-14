"use client";

import { useTranslations } from "next-intl";

type Props = {
  onChooseTemplate?: () => void;
};

export function TrainPlanWeekBanner({ onChooseTemplate }: Props) {
  const t = useTranslations("trains.planWeekBanner");

  return (
    <section
      className="rounded-xl border border-hq-accent/35 bg-hq-accent/10 px-4 py-3"
      data-testid="trains-plan-week-banner"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#c9d1d9]">{t("title")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-hq-fg-muted">
            {t("body")}
          </p>
        </div>
        {onChooseTemplate ? (
          <button
            type="button"
            onClick={onChooseTemplate}
            className="shrink-0 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400"
          >
            {t("chooseTemplate")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
