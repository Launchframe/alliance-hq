"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  assignVrChartStyles,
  svgPathForVrChartShape,
} from "@/lib/vr/vr-chart-style.shared";
import {
  DEFAULT_PROJECTION_HORIZON_DAYS,
  PROJECTION_HORIZON_OPTIONS,
} from "@/lib/vr/vr-projection.shared";
import type { VrProgressCommanderSeries } from "@/lib/vr/vr-progress-chart.shared";
import {
  buildVrProgressChartSvg,
  defaultVisibleVrCommanderIds,
  VR_PROGRESS_CHART_DEFAULT_HEIGHT,
  VR_PROGRESS_CHART_DEFAULT_WIDTH,
} from "@/lib/vr/vr-progress-chart-render.shared";

type Props = {
  series: VrProgressCommanderSeries[];
  seasonKey: string;
  vrUpdatesLocked?: boolean;
  className?: string;
  ariaLabel?: string;
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function VrProgressProjectionChart({
  series,
  seasonKey,
  vrUpdatesLocked = false,
  className,
  ariaLabel,
}: Props) {
  const t = useTranslations("myVr.chart");
  const locale = useLocale();
  const [horizonDays, setHorizonDays] =
    useState<(typeof PROJECTION_HORIZON_OPTIONS)[number]>(
      DEFAULT_PROJECTION_HORIZON_DAYS,
    );
  const seriesKey = series.map((row) => row.commanderId).join("|");
  const [visibleCommanderIds, setVisibleCommanderIds] = useState<Set<string>>(
    () => new Set(defaultVisibleVrCommanderIds(series)),
  );
  const [syncedSeriesKey, setSyncedSeriesKey] = useState(seriesKey);
  if (syncedSeriesKey !== seriesKey) {
    setSyncedSeriesKey(seriesKey);
    setVisibleCommanderIds(new Set(defaultVisibleVrCommanderIds(series)));
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

  const chartSvg = useMemo(() => {
    if (eligibleSeries.length === 0) return null;
    return buildVrProgressChartSvg({
      series: eligibleSeries,
      seasonKey,
      width: VR_PROGRESS_CHART_DEFAULT_WIDTH,
      height: VR_PROGRESS_CHART_DEFAULT_HEIGHT,
      vrUpdatesLocked,
      now,
      locale,
      options: {
        projectionHorizonDays: horizonDays,
        visibleCommanderIds: [...visibleCommanderIds],
        labels: { nowLabel: t("nowLabel") },
        backgroundFill: null,
      },
    });
  }, [
    eligibleSeries,
    horizonDays,
    locale,
    now,
    seasonKey,
    t,
    visibleCommanderIds,
    vrUpdatesLocked,
  ]);

  if (eligibleSeries.length === 0 || !chartSvg) return null;

  const visibleSeries = eligibleSeries.filter((row) =>
    visibleCommanderIds.has(row.commanderId),
  );

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

  // Shared builder returns a full <svg> document; strip the outer tag so we can
  // control sizing/aria on the React host while keeping one plot definition.
  const innerSvg = chartSvg
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");

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
        viewBox={`0 0 ${VR_PROGRESS_CHART_DEFAULT_WIDTH} ${VR_PROGRESS_CHART_DEFAULT_HEIGHT}`}
        className="mt-4 h-auto w-full max-w-full"
        role="img"
        aria-label={ariaLabel ?? t("ariaLabel")}
        dangerouslySetInnerHTML={{ __html: innerSvg }}
      />

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
