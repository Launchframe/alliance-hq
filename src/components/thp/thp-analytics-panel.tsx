"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  THP_BREAKDOWN_KEYS,
  type MyThpEvent,
  type MyThpPercentileChange,
  type ThpBreakdown,
} from "@/lib/thp/my-thp.shared";
import { computeThpTotalGrowth } from "@/lib/thp/my-thp-chart.shared";

type Props = {
  events: MyThpEvent[];
  breakdown: ThpBreakdown | null;
  percentileChange: MyThpPercentileChange[];
};

const RANGE_DAYS = [30, 90, 180] as const;

const COMPOSITION_COLORS: Record<keyof ThpBreakdown, string> = {
  heroLevel: "#58a6ff",
  decorationsAndBuildings: "#3fb950",
  gear: "#d2a8ff",
  exclusiveWeapons: "#f778ba",
  heroTier: "#ffa657",
  heroSkill: "#f0883e",
  wallOfHonor: "#8b949e",
};

function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString()}`;
}

function latestBreakdownEvent(events: MyThpEvent[]): MyThpEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.breakdown) return events[i]!;
  }
  return null;
}

function earliestBreakdownEvent(events: MyThpEvent[]): MyThpEvent | null {
  for (const event of events) {
    if (event.breakdown) return event;
  }
  return null;
}

export function ThpAnalyticsPanel({ events, breakdown, percentileChange }: Props) {
  const t = useTranslations("myThp");
  const [selectedDays, setSelectedDays] = useState<(typeof RANGE_DAYS)[number]>(30);

  const growth = useMemo(() => computeThpTotalGrowth(events), [events]);

  const fastestGrowing = useMemo(() => {
    const first = earliestBreakdownEvent(events);
    const last = latestBreakdownEvent(events);
    if (!first || !last || first === last) return null;

    let bestKey: keyof ThpBreakdown | null = null;
    let bestDelta = 0;
    for (const key of THP_BREAKDOWN_KEYS) {
      const delta = last.breakdown![key] - first.breakdown![key];
      if (bestKey == null || delta > bestDelta) {
        bestKey = key;
        bestDelta = delta;
      }
    }
    if (bestKey == null || bestDelta <= 0) return null;
    return { key: bestKey, delta: bestDelta };
  }, [events]);

  const composition = useMemo(() => {
    const source = breakdown ?? latestBreakdownEvent(events)?.breakdown ?? null;
    if (!source) return null;
    const total = THP_BREAKDOWN_KEYS.reduce((sum, key) => sum + source[key], 0);
    if (total <= 0) return null;
    return THP_BREAKDOWN_KEYS.map((key) => ({
      key,
      value: source[key],
      pct: (source[key] / total) * 100,
    })).sort((a, b) => b.value - a.value);
  }, [breakdown, events]);

  const selectedChange = percentileChange.find((c) => c.days === selectedDays) ?? null;

  return (
    <div className="space-y-5 rounded-xl border border-hq-border bg-hq-surface p-4">
      <h2 className="text-sm font-semibold text-hq-fg">{t("analyticsTitle")}</h2>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("totalGrowthLabel")}
        </p>
        {growth != null ? (
          <p className="font-mono text-lg font-semibold text-hq-fg" data-testid="my-thp-total-growth">
            {formatSigned(growth)}
          </p>
        ) : (
          <p className="text-sm text-hq-fg-subtle">{t("totalGrowthNotEnough")}</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("fastestGrowingLabel")}
        </p>
        {fastestGrowing ? (
          <p className="text-sm text-hq-fg" data-testid="my-thp-fastest-growing">
            {t("fastestGrowingValue", {
              component: t(`breakdownFields.${fastestGrowing.key}`),
              delta: formatSigned(fastestGrowing.delta),
            })}
          </p>
        ) : (
          <p className="text-sm text-hq-fg-subtle">{t("fastestGrowingNotEnough")}</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("compositionTitle")}
        </p>
        {composition ? (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-hq-surface-muted">
              {composition.map((item) => (
                <div
                  key={item.key}
                  style={{
                    width: `${item.pct}%`,
                    backgroundColor: COMPOSITION_COLORS[item.key],
                  }}
                  title={t(`breakdownFields.${item.key}`)}
                />
              ))}
            </div>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-hq-fg-muted sm:grid-cols-2">
              {composition.map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COMPOSITION_COLORS[item.key] }}
                  />
                  <span className="min-w-0 truncate">
                    {t(`breakdownFields.${item.key}`)}
                  </span>
                  <span className="ml-auto font-mono">{item.pct.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-hq-fg-subtle">{t("noBreakdownYet")}</p>
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
              data-testid={`my-thp-percentile-change-${days}`}
            >
              {t(`percentileChangeDays${days}` as "percentileChangeDays30")}
            </button>
          ))}
        </div>
        {selectedChange &&
        selectedChange.percentileThen != null &&
        selectedChange.percentileNow != null &&
        selectedChange.delta != null ? (
          <p className="text-sm text-hq-fg" data-testid="my-thp-percentile-change-summary">
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
