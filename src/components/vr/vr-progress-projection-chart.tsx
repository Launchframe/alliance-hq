"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  assignVrChartStyles,
  svgPathForVrChartShape,
} from "@/lib/vr/vr-chart-style.shared";
import {
  DEFAULT_PROJECTION_HORIZON_DAYS,
  PROJECTION_HORIZON_OPTIONS,
  projectVrSeries,
} from "@/lib/vr/vr-projection.shared";
import type { VrProgressCommanderSeries } from "@/lib/vr/vr-progress-chart.shared";

type Props = {
  series: VrProgressCommanderSeries[];
  seasonKey: string;
  vrUpdatesLocked?: boolean;
  className?: string;
  ariaLabel?: string;
};

type Point = {
  x: number;
  y: number;
  atMs: number;
  baseVr: number;
};

const CHART_WIDTH = 760;
const CHART_HEIGHT = 300;
const PAD = { top: 24, right: 24, bottom: 36, left: 56 };
const MARKER_SIZE = 9;
const DEFAULT_VISIBLE = 5;

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
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

function defaultVisibleIds(series: VrProgressCommanderSeries[]): Set<string> {
  const sorted = [...series].sort((a, b) => a.rank - b.rank);
  const ids = new Set<string>();
  for (const row of sorted.slice(0, DEFAULT_VISIBLE)) {
    ids.add(row.commanderId);
  }
  const viewer = series.find((row) => row.isViewer);
  if (viewer) ids.add(viewer.commanderId);
  return ids;
}

export function VrProgressProjectionChart({
  series,
  seasonKey,
  vrUpdatesLocked = false,
  className,
  ariaLabel,
}: Props) {
  const t = useTranslations("myVr.chart");
  const [horizonDays, setHorizonDays] =
    useState<(typeof PROJECTION_HORIZON_OPTIONS)[number]>(
      DEFAULT_PROJECTION_HORIZON_DAYS,
    );
  const seriesKey = series.map((row) => row.commanderId).join("|");
  const [visibleCommanderIds, setVisibleCommanderIds] = useState<Set<string>>(
    () => defaultVisibleIds(series),
  );
  const [syncedSeriesKey, setSyncedSeriesKey] = useState(seriesKey);
  if (syncedSeriesKey !== seriesKey) {
    setSyncedSeriesKey(seriesKey);
    setVisibleCommanderIds(defaultVisibleIds(series));
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [pickerOpen]);

  const eligibleSeries = useMemo(
    () => series.filter((row) => row.events.length >= 1),
    [series],
  );

  const styles = useMemo(() => {
    const ids = eligibleSeries.map((row) => row.commanderId);
    const viewerFlags = new Map(
      eligibleSeries.map((row) => [row.commanderId, row.isViewer]),
    );
    return assignVrChartStyles(ids, viewerFlags);
  }, [eligibleSeries]);

  const projectedByCommander = useMemo(() => {
    const map = new Map<string, Array<{ at: string; baseVr: number }>>();
    for (const row of eligibleSeries) {
      map.set(
        row.commanderId,
        vrUpdatesLocked
          ? []
          : projectVrSeries({
              events: row.events.map((event) => ({
                createdAt: event.at,
                baseVr: event.baseVr,
                instituteLevel: event.instituteLevel,
              })),
              seasonKey,
              now,
              horizonDays,
            }),
      );
    }
    return map;
  }, [eligibleSeries, horizonDays, now, seasonKey, vrUpdatesLocked]);

  if (eligibleSeries.length === 0) return null;

  const visibleSeries = eligibleSeries.filter((row) =>
    visibleCommanderIds.has(row.commanderId),
  );
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
  const innerW = CHART_WIDTH - PAD.left - PAD.right;
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const timeSpan = Math.max(1, maxTime - minTime);
  const vrSpan = Math.max(250, maxVr - minVr);
  const xForTime = (timeMs: number) =>
    PAD.left + ((timeMs - minTime) / timeSpan) * innerW;
  const yForVr = (baseVr: number) =>
    PAD.top + innerH - ((baseVr - minVr) / vrSpan) * innerH;
  const nowX = xForTime(nowMs);

  const toggleCommander = (commanderId: string) => {
    setVisibleCommanderIds((current) => {
      const next = new Set(current);
      if (next.has(commanderId)) {
        if (next.size <= 1) return current;
        next.delete(commanderId);
      } else {
        next.add(commanderId);
      }
      return next;
    });
  };

  return (
    <section
      className={cn(
        "rounded-2xl border border-hq-border bg-hq-surface p-4 sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
          {!vrUpdatesLocked ? (
            <p className="mt-1 text-xs text-hq-fg-muted">
              {visibleSeries.some((row) => row.events.length > 1)
                ? t("projectionDisclaimer")
                : t("insufficientData")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs font-medium text-hq-fg"
              aria-expanded={pickerOpen}
              aria-haspopup="listbox"
            >
              {t("commanderPicker", { count: visibleCommanderIds.size })}
            </button>
            {pickerOpen ? (
              <div
                className="absolute right-0 z-20 mt-2 max-h-64 w-64 overflow-y-auto rounded-xl border border-hq-border bg-hq-surface p-2 shadow-lg"
                role="listbox"
                aria-multiselectable
                aria-label={t("legend")}
              >
                {eligibleSeries.map((row) => {
                  const style = styles.get(row.commanderId);
                  const selected = visibleCommanderIds.has(row.commanderId);
                  if (!style) return null;
                  return (
                    <label
                      key={row.commanderId}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-hq-surface-muted",
                        row.isViewer && "font-semibold",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleCommander(row.commanderId)}
                        className="rounded border-hq-border"
                      />
                      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
                        <path
                          d={svgPathForVrChartShape(style.shape, 8, 8, 9)}
                          fill={style.color}
                        />
                      </svg>
                      <span className="truncate text-hq-fg">
                        {row.rank}. {row.memberName}
                        {row.isViewer ? ` (${t("you")})` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
          {!vrUpdatesLocked ? (
            <div
              className="flex items-center gap-2"
              aria-label={t("horizonLabel")}
            >
              <span className="text-xs text-hq-fg-muted">{t("horizonLabel")}</span>
              <div className="inline-flex rounded-lg border border-hq-border bg-hq-surface-muted p-0.5">
                {PROJECTION_HORIZON_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setHorizonDays(days)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      horizonDays === days
                        ? "bg-hq-accent text-white"
                        : "text-hq-fg-muted hover:text-hq-fg",
                    )}
                  >
                    {t(`horizon${days}d`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="mt-4 h-auto w-full max-w-full"
        role="img"
        aria-label={ariaLabel ?? t("ariaLabel")}
      >
        <line
          x1={PAD.left}
          y1={PAD.top + innerH}
          x2={PAD.left + innerW}
          y2={PAD.top + innerH}
          stroke="#30363d"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + innerH}
          stroke="#30363d"
          strokeWidth={1}
        />
        <line
          x1={nowX}
          y1={PAD.top}
          x2={nowX}
          y2={PAD.top + innerH}
          stroke="#8b949e"
          strokeDasharray="2 4"
          strokeWidth={1}
        />
        <text x={nowX + 5} y={PAD.top + 12} fill="#8b949e" fontSize={10}>
          {t("nowLabel")}
        </text>
        <text
          x={PAD.left - 8}
          y={PAD.top + 4}
          fill="#8b949e"
          fontSize={10}
          textAnchor="end"
        >
          {maxVr.toLocaleString()}
        </text>
        <text
          x={PAD.left - 8}
          y={PAD.top + innerH}
          fill="#8b949e"
          fontSize={10}
          textAnchor="end"
          dominantBaseline="hanging"
        >
          {minVr.toLocaleString()}
        </text>
        <text
          x={PAD.left}
          y={PAD.top + innerH + 18}
          fill="#8b949e"
          fontSize={10}
          textAnchor="start"
        >
          {formatShortDate(new Date(minTime).toISOString())}
        </text>
        <text
          x={PAD.left + innerW}
          y={PAD.top + innerH + 18}
          fill="#8b949e"
          fontSize={10}
          textAnchor="end"
        >
          {formatShortDate(new Date(maxTime).toISOString())}
        </text>

        {visibleSeries.map((row) => {
          const style = styles.get(row.commanderId);
          if (!style) return null;
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
          return (
            <g key={row.commanderId}>
              <path
                d={smoothPath(history)}
                fill="none"
                stroke={style.color}
                strokeWidth={row.isViewer ? 3 : 2.25}
                strokeDasharray={style.dashArray}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {projection.length > 1 ? (
                <path
                  d={smoothPath(projection)}
                  fill="none"
                  stroke={style.color}
                  strokeWidth={row.isViewer ? 3 : 2.25}
                  strokeDasharray={style.dashArray || "6 4"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.45}
                />
              ) : null}
              {history.map((point) => (
                <path
                  key={`${row.commanderId}:${point.atMs}`}
                  d={svgPathForVrChartShape(
                    style.shape,
                    point.x,
                    point.y,
                    MARKER_SIZE,
                  )}
                  fill={style.color}
                  stroke="#0d1117"
                  strokeWidth={1}
                />
              ))}
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap gap-2" aria-label={t("legend")}>
        {visibleSeries.map((row) => {
          const style = styles.get(row.commanderId);
          if (!style) return null;
          return (
            <span
              key={row.commanderId}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-hq-border px-3 py-1 text-xs text-hq-fg",
                row.isViewer && "ring-2 ring-hq-accent/60",
              )}
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
                <path
                  d={svgPathForVrChartShape(style.shape, 8, 8, 9)}
                  fill={style.color}
                />
              </svg>
              {row.rank}. {row.memberName}
            </span>
          );
        })}
      </div>
    </section>
  );
}
