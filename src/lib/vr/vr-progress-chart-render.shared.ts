/**
 * Shared VR progress chart SVG document builder.
 * Used by the My VR React chart and Discord/dev PNG pipeline — one plot definition.
 */

import {
  assignVrChartStyles,
  svgPathForVrChartShape,
} from "@/lib/vr/vr-chart-style.shared";
import {
  DEFAULT_PROJECTION_HORIZON_DAYS,
  projectVrSeries,
} from "@/lib/vr/vr-projection.shared";
import type { VrProgressCommanderSeries } from "@/lib/vr/vr-progress-chart.shared";

export const VR_PROGRESS_CHART_DEFAULT_WIDTH = 760;
export const VR_PROGRESS_CHART_DEFAULT_HEIGHT = 300;
/** Discord / preview PNG canvas */
export const VR_PROGRESS_CHART_DISCORD_WIDTH = 1200;
export const VR_PROGRESS_CHART_DISCORD_HEIGHT = 675;

const PAD = { top: 24, right: 24, bottom: 36, left: 56 };
const MARKER_SIZE = 9;
const DEFAULT_VISIBLE = 5;

type Point = {
  x: number;
  y: number;
  atMs: number;
  baseVr: number;
};

export type VrProgressChartSvgLabels = {
  nowLabel: string;
};

export type BuildVrProgressChartSvgInput = {
  series: VrProgressCommanderSeries[];
  seasonKey: string;
  width?: number;
  height?: number;
  vrUpdatesLocked?: boolean;
  now?: Date;
  options?: {
    projectionHorizonDays?: number;
    visibleCommanderIds?: string[];
    labels?: Partial<VrProgressChartSvgLabels>;
    /** Chart canvas fill. Pass null to omit (web embeds over a surface). */
    backgroundFill?: string | null;
  };
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0]!.x} ${points[0]!.y}`;

  const commands = [`M${points[0]!.x} ${points[0]!.y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    commands.push(`C${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`);
  }
  return commands.join(" ");
}

function pointFromEvent(
  event: { at: string; baseVr: number },
  xForTime: (timeMs: number) => number,
  yForVr: (baseVr: number) => number,
): Point {
  const atMs = new Date(event.at).getTime();
  return {
    x: xForTime(atMs),
    y: yForVr(event.baseVr),
    atMs,
    baseVr: event.baseVr,
  };
}

export function defaultVisibleVrCommanderIds(
  series: VrProgressCommanderSeries[],
): string[] {
  const sorted = [...series].sort((a, b) => a.rank - b.rank);
  const ids = new Set<string>();
  for (const row of sorted.slice(0, DEFAULT_VISIBLE)) {
    ids.add(row.commanderId);
  }
  const viewer = series.find((row) => row.isViewer);
  if (viewer) ids.add(viewer.commanderId);
  return [...ids];
}

/**
 * Returns a full `<svg>…</svg>` document for the VR progress plot, or null
 * when there is nothing to draw.
 */
export function buildVrProgressChartSvg(
  input: BuildVrProgressChartSvgInput,
): string | null {
  const width = input.width ?? VR_PROGRESS_CHART_DEFAULT_WIDTH;
  const height = input.height ?? VR_PROGRESS_CHART_DEFAULT_HEIGHT;
  const now = input.now ?? new Date();
  const vrUpdatesLocked = input.vrUpdatesLocked ?? false;
  const horizonDays =
    input.options?.projectionHorizonDays ?? DEFAULT_PROJECTION_HORIZON_DAYS;
  const nowLabel = input.options?.labels?.nowLabel ?? "Now";
  const backgroundFill =
    input.options?.backgroundFill === undefined
      ? "#0d1117"
      : input.options.backgroundFill;

  const eligibleSeries = input.series.filter((row) => row.events.length >= 1);
  if (eligibleSeries.length === 0) return null;

  const visibleIdList =
    input.options?.visibleCommanderIds ??
    defaultVisibleVrCommanderIds(eligibleSeries);
  const visibleCommanderIds = new Set(visibleIdList);
  const visibleSeries = eligibleSeries.filter((row) =>
    visibleCommanderIds.has(row.commanderId),
  );
  if (visibleSeries.length === 0) return null;

  const styles = assignVrChartStyles(
    eligibleSeries.map((row) => row.commanderId),
    new Map(eligibleSeries.map((row) => [row.commanderId, row.isViewer])),
  );

  const projectedByCommander = new Map<
    string,
    Array<{ at: string; baseVr: number }>
  >();
  for (const row of eligibleSeries) {
    projectedByCommander.set(
      row.commanderId,
      vrUpdatesLocked
        ? []
        : projectVrSeries({
            events: row.events.map((event) => ({
              createdAt: event.at,
              baseVr: event.baseVr,
              instituteLevel: event.instituteLevel,
            })),
            seasonKey: input.seasonKey,
            now,
            horizonDays,
          }),
    );
  }

  const allProjectedEvents = visibleSeries.flatMap(
    (row) => projectedByCommander.get(row.commanderId) ?? [],
  );
  const nowMs = now.getTime();
  const minTime = Math.min(
    ...visibleSeries.flatMap((row) =>
      row.events.map((event) => new Date(event.at).getTime()),
    ),
    nowMs,
  );
  const maxTime = vrUpdatesLocked
    ? Math.max(
        ...visibleSeries.flatMap((row) =>
          row.events.map((event) => new Date(event.at).getTime()),
        ),
        nowMs,
      )
    : nowMs + horizonDays * 24 * 60 * 60 * 1000;
  const minVr = Math.min(
    ...visibleSeries.flatMap((row) => row.events.map((event) => event.baseVr)),
    ...(allProjectedEvents.length
      ? allProjectedEvents.map((event) => event.baseVr)
      : [0]),
  );
  const maxVr = Math.max(
    ...visibleSeries.flatMap((row) => row.events.map((event) => event.baseVr)),
    ...allProjectedEvents.map((event) => event.baseVr),
  );

  const padScaleX = width / VR_PROGRESS_CHART_DEFAULT_WIDTH;
  const padScaleY = height / VR_PROGRESS_CHART_DEFAULT_HEIGHT;
  const pad = {
    top: PAD.top * padScaleY,
    right: PAD.right * padScaleX,
    bottom: PAD.bottom * padScaleY,
    left: PAD.left * padScaleX,
  };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const timeSpan = Math.max(1, maxTime - minTime);
  const vrSpan = Math.max(250, maxVr - minVr);
  const xForTime = (timeMs: number) =>
    pad.left + ((timeMs - minTime) / timeSpan) * innerW;
  const yForVr = (baseVr: number) =>
    pad.top + innerH - ((baseVr - minVr) / vrSpan) * innerH;
  const nowX = xForTime(nowMs);
  const markerSize = MARKER_SIZE * Math.min(padScaleX, padScaleY);

  const seriesMarkup = visibleSeries
    .map((row) => {
      const style = styles.get(row.commanderId);
      if (!style) return "";
      const history = row.events.map((event) =>
        pointFromEvent(event, xForTime, yForVr),
      );
      const projectionRaw = projectedByCommander.get(row.commanderId) ?? [];
      const lastHistory = history.at(-1);
      const projection =
        lastHistory && projectionRaw.length > 0
          ? [
              lastHistory,
              ...projectionRaw.map((event) =>
                pointFromEvent(event, xForTime, yForVr),
              ),
            ]
          : projectionRaw.map((event) =>
              pointFromEvent(event, xForTime, yForVr),
            );
      const strokeWidth = row.isViewer ? 3 : 2.25;
      const historyPath = smoothPath(history);
      const projectionPath =
        projection.length > 1
          ? `<path d="${smoothPath(projection)}" fill="none" stroke="${style.color}" stroke-width="${strokeWidth}" stroke-dasharray="${style.dashArray || "6 4"}" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" />`
          : "";
      const markers = history
        .map(
          (point) =>
            `<path d="${svgPathForVrChartShape(style.shape, point.x, point.y, markerSize)}" fill="${style.color}" stroke="#0d1117" stroke-width="1" />`,
        )
        .join("");
      return `<g>
        <path d="${historyPath}" fill="none" stroke="${style.color}" stroke-width="${strokeWidth}" stroke-dasharray="${style.dashArray}" stroke-linecap="round" stroke-linejoin="round" />
        ${projectionPath}
        ${markers}
      </g>`;
    })
    .join("");

  const backgroundRect =
    backgroundFill == null
      ? ""
      : `<rect width="100%" height="100%" fill="${escapeXml(backgroundFill)}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
  ${backgroundRect}
  <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${pad.left + innerW}" y2="${pad.top + innerH}" stroke="#30363d" stroke-width="1" />
  <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerH}" stroke="#30363d" stroke-width="1" />
  <line x1="${nowX}" y1="${pad.top}" x2="${nowX}" y2="${pad.top + innerH}" stroke="#8b949e" stroke-dasharray="2 4" stroke-width="1" />
  <text x="${nowX + 5}" y="${pad.top + 12}" fill="#8b949e" font-size="10" font-family="system-ui,sans-serif">${escapeXml(nowLabel)}</text>
  <text x="${pad.left - 8}" y="${pad.top + 4}" fill="#8b949e" font-size="10" text-anchor="end" font-family="system-ui,sans-serif">${maxVr.toLocaleString("en-US")}</text>
  <text x="${pad.left - 8}" y="${pad.top + innerH}" fill="#8b949e" font-size="10" text-anchor="end" dominant-baseline="hanging" font-family="system-ui,sans-serif">${minVr.toLocaleString("en-US")}</text>
  <text x="${pad.left}" y="${pad.top + innerH + 18}" fill="#8b949e" font-size="10" text-anchor="start" font-family="system-ui,sans-serif">${escapeXml(formatShortDate(new Date(minTime).toISOString()))}</text>
  <text x="${pad.left + innerW}" y="${pad.top + innerH + 18}" fill="#8b949e" font-size="10" text-anchor="end" font-family="system-ui,sans-serif">${escapeXml(formatShortDate(new Date(maxTime).toISOString()))}</text>
  ${seriesMarkup}
</svg>`;
}
