"use client";

import { useTranslations } from "next-intl";

type Props = {
  onPivot: () => void;
  busy?: boolean;
};

export function TrainPivotBanner({ onPivot, busy = false }: Props) {
  const t = useTranslations("trains.pivotBanner");

  return (
    <section className="rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-violet-100">{t("title")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-violet-100/90">
            {t("body")}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onPivot}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {busy ? t("applying") : t("action")}
        </button>
      </div>
    </section>
  );
}
