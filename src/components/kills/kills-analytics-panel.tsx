"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import type {
  MyKillsEvent,
  MyKillsPercentileChange,
} from "@/lib/kills/my-kills.shared";
import { computeKillsTotalGrowth } from "@/lib/kills/my-kills-chart.shared";

type Props = {
  events: MyKillsEvent[];
  percentileChange: MyKillsPercentileChange[];
};

const RANGE_DAYS = [30, 90, 180] as const;

function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString()}`;
}

export function KillsAnalyticsPanel({ events, percentileChange }: Props) {
  const t = useTranslations("myKills");
  const [selectedDays, setSelectedDays] = useState<(typeof RANGE_DAYS)[number]>(30);

  const growth = useMemo(() => computeKillsTotalGrowth(events), [events]);

  const selectedChange =
    percentileChange.find((c) => c.days === selectedDays) ?? null;

  return (
    <div className="space-y-5 rounded-xl border border-hq-border bg-hq-surface p-4">
      <h2 className="text-sm font-semibold text-hq-fg">{t("analyticsTitle")}</h2>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("totalGrowthLabel")}
        </p>
        {growth != null ? (
          <p
            className="font-mono text-lg font-semibold text-hq-fg"
            data-testid="my-kills-total-growth"
          >
            {formatSigned(growth)}
          </p>
        ) : (
          <p className="text-sm text-hq-fg-subtle">{t("totalGrowthNotEnough")}</p>
        )}
      </div>

      <div className="space-y-2 border-t border-hq-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("percentileChangeTitle")}
        </p>
        <div
          className="flex gap-1 rounded-lg border border-hq-border bg-hq-canvas p-1"
          role="tablist"
          aria-label={t("percentileChangeRangeAria")}
        >
          {RANGE_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              role="tab"
              aria-selected={selectedDays === days}
              onClick={() => setSelectedDays(days)}
              className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                selectedDays === days
                  ? "bg-hq-surface-muted text-hq-fg"
                  : "text-hq-fg-muted hover:text-hq-fg"
              }`}
              data-testid={`my-kills-percentile-change-${days}`}
            >
              {t(`percentileChangeDays${days}` as "percentileChangeDays30")}
            </button>
          ))}
        </div>
        {selectedChange &&
        selectedChange.percentileThen != null &&
        selectedChange.percentileNow != null &&
        selectedChange.delta != null ? (
          <p
            className="text-sm text-hq-fg"
            data-testid="my-kills-percentile-change-summary"
          >
            {t("percentileChangeSummary", {
              percentileThen: selectedChange.percentileThen,
              percentileNow: selectedChange.percentileNow,
              delta: formatSigned(selectedChange.delta),
            })}
          </p>
        ) : (
          <p className="text-sm text-hq-fg-subtle">{t("percentileChangeNotEnough")}</p>
        )}
      </div>
    </div>
  );
}
