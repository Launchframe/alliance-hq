import "server-only";

import sharp from "sharp";

import type { ChartLocale } from "@/lib/charts/chart-locale-format.shared";
import {
  buildThpHistoryChartSvg,
  THP_HISTORY_CHART_DISCORD_HEIGHT,
  THP_HISTORY_CHART_DISCORD_WIDTH,
} from "@/lib/thp/thp-history-chart-render.shared";
import type { MyThpEvent } from "@/lib/thp/my-thp.shared";
import type { VrProgressCommanderSeries } from "@/lib/vr/vr-progress-chart.shared";
import {
  buildVrProgressChartSvg,
  VR_PROGRESS_CHART_DISCORD_HEIGHT,
  VR_PROGRESS_CHART_DISCORD_WIDTH,
} from "@/lib/vr/vr-progress-chart-render.shared";

export async function renderSvgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function renderVrProgressChartPng(input: {
  series: VrProgressCommanderSeries[];
  seasonKey: string;
  vrUpdatesLocked?: boolean;
  now?: Date;
  width?: number;
  height?: number;
  nowLabel?: string;
  locale?: ChartLocale;
}): Promise<Buffer | null> {
  const svg = buildVrProgressChartSvg({
    series: input.series,
    seasonKey: input.seasonKey,
    width: input.width ?? VR_PROGRESS_CHART_DISCORD_WIDTH,
    height: input.height ?? VR_PROGRESS_CHART_DISCORD_HEIGHT,
    vrUpdatesLocked: input.vrUpdatesLocked,
    now: input.now,
    locale: input.locale,
    options: {
      labels: input.nowLabel ? { nowLabel: input.nowLabel } : undefined,
    },
  });
  if (!svg) return null;
  return renderSvgToPng(svg);
}

export async function renderThpHistoryChartPng(input: {
  events: MyThpEvent[];
  width?: number;
  height?: number;
  locale?: ChartLocale;
}): Promise<Buffer | null> {
  const svg = buildThpHistoryChartSvg({
    events: input.events,
    width: input.width ?? THP_HISTORY_CHART_DISCORD_WIDTH,
    height: input.height ?? THP_HISTORY_CHART_DISCORD_HEIGHT,
    locale: input.locale,
  });
  if (!svg) return null;
  return renderSvgToPng(svg);
}
