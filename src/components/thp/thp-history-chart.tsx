"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";

import type { MyThpEvent } from "@/lib/thp/my-thp.shared";
import {
  buildThpHistoryChartSvg,
  THP_HISTORY_CHART_DEFAULT_HEIGHT,
  THP_HISTORY_CHART_DEFAULT_WIDTH,
} from "@/lib/thp/thp-history-chart-render.shared";

type Props = {
  events: MyThpEvent[];
  className?: string;
};

export function ThpHistoryChart({ events, className }: Props) {
  const locale = useLocale();
  const chartSvg = useMemo(
    () =>
      buildThpHistoryChartSvg({
        events,
        width: THP_HISTORY_CHART_DEFAULT_WIDTH,
        height: THP_HISTORY_CHART_DEFAULT_HEIGHT,
        locale,
        backgroundFill: null,
      }),
    [events, locale],
  );

  if (!chartSvg) return null;

  const innerSvg = chartSvg
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");

  return (
    <svg
      viewBox={`0 0 ${THP_HISTORY_CHART_DEFAULT_WIDTH} ${THP_HISTORY_CHART_DEFAULT_HEIGHT}`}
      className={className ?? "h-auto w-full max-w-full"}
      role="img"
      aria-label="THP over time"
      data-testid="my-thp-history-chart"
      dangerouslySetInnerHTML={{ __html: innerSvg }}
    />
  );
}
