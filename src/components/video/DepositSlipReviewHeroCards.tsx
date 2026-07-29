"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
import type { DepositSlipReviewHeroMetrics } from "@/lib/banks/deposit-slip-review-hero-metrics.shared";

type Props = {
  metrics: DepositSlipReviewHeroMetrics;
};

export function DepositSlipReviewHeroCards({ metrics }: Props) {
  const t = useTranslations("videoReview");
  const locale = useLocale();

  const snapshotLabel = useMemo(() => {
    const iso = metrics.active.snapshotAtIso;
    if (!iso) return null;
    try {
      return formatBrowserLocalDateTime(
        iso,
        { dateStyle: "medium", timeStyle: "short" },
        locale,
      );
    } catch {
      return iso;
    }
  }, [locale, metrics.active.snapshotAtIso]);

  const activePrimary =
    metrics.active.goal != null
      ? t("depositSlipHeroActiveVsGoal", {
          known: metrics.active.known,
          goal: metrics.active.goal,
        })
      : String(metrics.active.known);

  const maturedSuffix =
    metrics.matured.inVideo > 0
      ? t("depositSlipHeroInVideo", { count: metrics.matured.inVideo })
      : null;

  const lootedSuffix =
    metrics.looted.inVideo > 0
      ? t("depositSlipHeroInVideo", { count: metrics.looted.inVideo })
      : null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("depositSlipHeroActive")}
        </p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-hq-fg">
          {activePrimary}
        </p>
        {metrics.active.goal != null && snapshotLabel ? (
          <p className="mt-2 text-xs text-hq-fg-muted">
            {t("depositSlipHeroCityListSnapshot", { time: snapshotLabel })}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("depositSlipHeroMatured")}
        </p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-hq-fg">
          {metrics.matured.hqTotal}
          {maturedSuffix ? (
            <span className="ml-1 text-base font-normal text-hq-fg-muted">
              {maturedSuffix}
            </span>
          ) : null}
        </p>
      </div>

      <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("depositSlipHeroLooted")}
        </p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-hq-fg">
          {metrics.looted.hqTotal}
          {lootedSuffix ? (
            <span className="ml-1 text-base font-normal text-hq-fg-muted">
              {lootedSuffix}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
