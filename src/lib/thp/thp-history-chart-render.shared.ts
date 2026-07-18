/**
 * Shared THP history chart SVG document builder.
 * Used by My THP React chart and Discord/dev PNG pipeline — one plot definition.
 */

import {
  formatChartCompactNumber,
  formatChartShortDate,
  type ChartLocale,
} from "@/lib/charts/chart-locale-format.shared";
import type { MyThpEvent } from "@/lib/thp/my-thp.shared";
import { thpChartYDomain } from "@/lib/thp/my-thp-chart.shared";

export const THP_HISTORY_CHART_DEFAULT_WIDTH = 640;
export const THP_HISTORY_CHART_DEFAULT_HEIGHT = 200;
export const THP_HISTORY_CHART_DISCORD_WIDTH = 1200;
export const THP_HISTORY_CHART_DISCORD_HEIGHT = 675;

const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

export type BuildThpHistoryChartSvgInput = {
  events: MyThpEvent[];
  width?: number;
  height?: number;
  /** BCP 47 locale for axis dates/numbers (Discord bot or web UI locale). */
  locale?: ChartLocale;
  /** Chart canvas fill. Pass null to omit (web embeds over a surface). */
  backgroundFill?: string | null;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Full `<svg>…</svg>` for THP history, or null when fewer than 2 events. */
export function buildThpHistoryChartSvg(
  input: BuildThpHistoryChartSvgInput,
): string | null {
  const events = input.events;
  if (events.length < 2) return null;

  const width = input.width ?? THP_HISTORY_CHART_DEFAULT_WIDTH;
  const height = input.height ?? THP_HISTORY_CHART_DEFAULT_HEIGHT;
  const locale = input.locale ?? "en-US";
  const backgroundFill =
    input.backgroundFill === undefined ? "#0d1117" : input.backgroundFill;
  const padScaleX = width / THP_HISTORY_CHART_DEFAULT_WIDTH;
  const padScaleY = height / THP_HISTORY_CHART_DEFAULT_HEIGHT;
  const pad = {
    top: PAD.top * padScaleY,
    right: PAD.right * padScaleX,
    bottom: PAD.bottom * padScaleY,
    left: PAD.left * padScaleX,
  };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const { min: minThp, max: maxThp, span: thpSpan } = thpChartYDomain(
    events.map((event) => event.total),
  );

  const points = events.map((event, index) => {
    const x = pad.left + (index / (events.length - 1)) * innerW;
    const y = pad.top + innerH - ((event.total - minThp) / thpSpan) * innerH;
    return { x, y, event };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const markers = points
    .map(
      (point) => `<g>
      <circle cx="${point.x}" cy="${point.y}" r="4" fill="#58a6ff" />
      <text x="${point.x}" y="${pad.top + innerH + 16}" fill="#8b949e" font-size="10" text-anchor="middle" font-family="system-ui,sans-serif">${escapeXml(formatChartShortDate(point.event.createdAt, locale))}</text>
    </g>`,
    )
    .join("");

  const backgroundRect =
    backgroundFill == null
      ? ""
      : `<rect width="100%" height="100%" fill="${escapeXml(backgroundFill)}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" data-testid="my-thp-history-chart">
  ${backgroundRect}
  <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${pad.left + innerW}" y2="${pad.top + innerH}" stroke="#30363d" stroke-width="1" />
  <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerH}" stroke="#30363d" stroke-width="1" />
  <text x="${pad.left - 8}" y="${pad.top + 4}" fill="#8b949e" font-size="10" text-anchor="end" font-family="system-ui,sans-serif">${escapeXml(formatChartCompactNumber(maxThp, locale))}</text>
  <text x="${pad.left - 8}" y="${pad.top + innerH}" fill="#8b949e" font-size="10" text-anchor="end" dominant-baseline="hanging" font-family="system-ui,sans-serif">${escapeXml(formatChartCompactNumber(minThp, locale))}</text>
  <polyline fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${polyline}" />
  ${markers}
</svg>`;
}
