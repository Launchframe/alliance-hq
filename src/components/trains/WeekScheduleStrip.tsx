"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import { addCalendarDays, isCalendarDateOnOrAfter } from "@/lib/trains/game-time";
import { buildProvisionalWeekPage } from "@/lib/client/week-schedule-provisional";
import { useCoverFlowCarousel } from "@/lib/client/use-cover-flow-carousel";
import {
  useWeekScheduleInfiniteDays,
  weekRangeForDate,
  type WeekCarouselDayEntry,
} from "@/lib/client/use-week-schedule-infinite-days";
import { calendarCellStyleClass, calendarCellOpaqueStyleClass } from "@/lib/trains/calendar-cell-styles.shared";
import {
  canSpinConductorForDay,
  canSpinVipForDay,
} from "@/lib/trains/conductor-mechanism.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import { usesCombinedSegmentDisplay } from "@/lib/trains/week-template-registry.shared";
import { coverFlowItemStyle } from "@/lib/client/cover-flow-carousel.shared";

type Props = {
  today: string;
  initialWeekStart: string;
  initialWeekEnd: string;
  initialDayConfigs: WeekScheduleDayConfig[];
  initialWeekRecords: WeekConductorRecordSummary[];
  selectedDate: string;
  conductorLabels: Record<string, string>;
  vipLabels: Record<string, string>;
  templateShortLabels?: Partial<Record<WeekTemplateType, string>>;
  navLabels: {
    previousWeek: string;
    nextWeek: string;
    previousDay?: string;
    nextDay?: string;
  };
  externalWeek?: WeekSchedulePagePayload;
  onSelectDate: (date: string) => void;
  onWeekChange?: (page: WeekSchedulePagePayload) => void;
  onWeekLoadError?: (message: string) => void;
};

const WEEK_CAROUSEL_VIEWPORT_HEIGHT_PX = 156;
const WEEK_CAROUSEL_PIXELS_PER_ITEM = 92;
const WEEK_CAROUSEL_VISIBLE_RANGE = 2;
const WEEK_CAROUSEL_TRANSLATE_X_PERCENT = 72;

function recordForDate(
  weekRecords: WeekConductorRecordSummary[],
  date: string,
): WeekConductorRecordSummary | undefined {
  return weekRecords.find((r) => r.date === date);
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const fmt = (date: string) =>
    new Date(`${date}T12:00:00-02:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "Etc/GMT+2",
    });
  return `${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

function weekdayLabel(date: string): string {
  return new Date(`${date}T12:00:00-02:00`).toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "Etc/GMT+2",
  });
}

type DayCellOptions = {
  day: WeekScheduleDayConfig;
  weekRecords: WeekConductorRecordSummary[];
  today: string;
  weekEnd: string;
  showDetail: boolean;
  conductorLabels: Record<string, string>;
  vipLabels: Record<string, string>;
  templateShortLabels?: Partial<Record<WeekTemplateType, string>>;
  className?: string;
  layout?: "grid" | "carousel";
  onSelect?: () => void;
};

function WeekScheduleDayCell({
  day,
  weekRecords,
  today,
  weekEnd,
  showDetail,
  conductorLabels,
  vipLabels,
  templateShortLabels,
  className = "",
  layout = "grid",
  onSelect,
}: DayCellOptions) {
  const isToday = day.date === today;
  const selectable =
    isCalendarDateOnOrAfter(day.date, today) &&
    isCalendarDateOnOrAfter(weekEnd, day.date);
  const style =
    layout === "carousel"
      ? calendarCellOpaqueStyleClass(day.conductorMechanism, day.paintTemplate)
      : calendarCellStyleClass(day.conductorMechanism, day.paintTemplate);
  const weekday = weekdayLabel(day.date);
  const vipLabel =
    day.vipMechanism && day.vipMechanism !== "none"
      ? (vipLabels[day.vipMechanism] ?? day.vipMechanism)
      : null;
  const combinedSegmentLabel =
    day.paintTemplate && usesCombinedSegmentDisplay(day.paintTemplate)
      ? (templateShortLabels?.[day.paintTemplate] ?? null)
      : null;
  const conductorLineLabel =
    combinedSegmentLabel ??
    (conductorLabels[day.conductorMechanism] ?? day.conductorMechanism);
  const record = recordForDate(weekRecords, day.date);
  const locked = Boolean(record?.lockedAt);
  const conductorName = record?.conductorMemberName;
  const vipName = record?.vipMemberName;

  const ringClass = showDetail
    ? "ring-2 ring-[#58a6ff] ring-offset-1 ring-offset-[#0d1117]"
    : isToday
      ? "ring-1 ring-[#58a6ff]/50 ring-offset-1 ring-offset-[#0d1117]"
      : "";

  const cellInner = (
    <>
      <div className="min-w-0">
        <div className="truncate text-[10px] font-medium uppercase tracking-wide opacity-80">
          {weekday}
        </div>
        <div className="text-xs font-semibold tabular-nums">{day.date.slice(5)}</div>
      </div>
      <div className="min-w-0 space-y-0.5">
        {!showDetail ? (
          <>
            <div className="truncate text-[10px] font-bold uppercase leading-tight">
              {conductorLineLabel}
            </div>
            {vipLabel && !combinedSegmentLabel ? (
              <div className="truncate text-[9px] font-medium uppercase leading-tight opacity-90">
                {vipLabel}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="truncate text-[9px] font-medium uppercase leading-tight opacity-75">
              {combinedSegmentLabel
                ? conductorLineLabel
                : `${conductorLabels[day.conductorMechanism] ?? day.conductorMechanism}${vipLabel ? ` · ${vipLabel}` : ""}`}
            </div>
            {conductorName ? (
              <div
                className={`truncate text-[11px] font-bold leading-tight ${
                  locked ? "text-white" : "text-[#8b949e]"
                }`}
                title={conductorName}
              >
                {conductorName}
              </div>
            ) : (
              <div className="truncate text-[10px] italic leading-tight text-[#8b949e]">
                —
              </div>
            )}
            {vipName ? (
              <div
                className={`truncate text-[9px] font-medium leading-tight ${
                  locked ? "opacity-95" : "text-[#6e7681]"
                }`}
                title={vipName}
              >
                {vipName}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );

  const baseClass = `flex flex-col justify-between rounded-lg border-2 text-left ${style} ${ringClass} ${className} ${
    layout === "carousel"
      ? "min-h-[7.25rem] w-[min(10.75rem,calc(100vw-8.5rem))] p-2.5"
      : "min-h-[7.25rem] w-[min(17rem,calc(100vw-4.5rem))] p-2.5"
  }`;

  if (selectable && onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={showDetail}
        aria-label={`${weekday} ${day.date.slice(5)}`}
        className={`${baseClass} transition-opacity hover:opacity-95`}
      >
        {cellInner}
      </button>
    );
  }

  return (
    <div className={`${baseClass} opacity-90`} aria-hidden={!selectable}>
      {cellInner}
    </div>
  );
}

type CarouselProps = {
  seedPage: WeekSchedulePagePayload;
  liveWeek?: WeekSchedulePagePayload;
  today: string;
  selectedDate: string;
  conductorLabels: Record<string, string>;
  vipLabels: Record<string, string>;
  templateShortLabels?: Partial<Record<WeekTemplateType, string>>;
  navLabels: Props["navLabels"];
  onSelectDate: (date: string) => void;
  onWeekChange?: (page: WeekSchedulePagePayload) => void;
  onWeekLoadError?: (message: string) => void;
  onCarouselWeekLabelChange: (weekStart: string, weekEnd: string) => void;
};

function WeekScheduleInfiniteDayCarousel({
  seedPage,
  liveWeek,
  today,
  selectedDate,
  conductorLabels,
  vipLabels,
  templateShortLabels,
  navLabels,
  onSelectDate,
  onWeekChange,
  onWeekLoadError,
  onCarouselWeekLabelChange,
}: CarouselProps) {
  const lastWeekStartRef = useRef<string | null>(null);
  const syncingDateRef = useRef(false);
  const daysRef = useRef<WeekCarouselDayEntry[]>([]);
  const bufferSyncRef = useRef(0);

  const {
    days,
    bootstrapping,
    ensureBuffer,
    ensureDateInBuffer,
    getPageForWeek,
    findIndexForDate,
    resolveIndexForDate,
  } = useWeekScheduleInfiniteDays({
    seedPage,
    onWeekLoadError,
  });

  const [carouselFallbackIndex, setCarouselFallbackIndex] = useState(0);

  useEffect(() => {
    daysRef.current = days;
  }, [days]);

  const dateIndex = findIndexForDate(selectedDate);
  const carouselSelectedIndex =
    dateIndex >= 0 ? dateIndex : carouselFallbackIndex;

  const notifyWeekForDate = useCallback(
    (date: string) => {
      const { weekStart, weekEnd } = weekRangeForDate(date);
      onCarouselWeekLabelChange(weekStart, weekEnd);
      if (lastWeekStartRef.current === weekStart) return;
      lastWeekStartRef.current = weekStart;
      const page = getPageForWeek(weekStart);
      if (page) onWeekChange?.(page);
    },
    [getPageForWeek, onCarouselWeekLabelChange, onWeekChange],
  );

  const handleIndexChange = useCallback(
    (index: number) => {
      if (syncingDateRef.current) return;
      const entry = daysRef.current[index];
      if (!entry) return;
      notifyWeekForDate(entry.day.date);
      onSelectDate(entry.day.date);
    },
    [notifyWeekForDate, onSelectDate],
  );

  const {
    position,
    interacting,
    isAnimating,
    viewportHandlers,
    setIndex,
    shiftPosition,
    stopMomentum,
    stopSnap,
  } = useCoverFlowCarousel({
    itemCount: days.length,
    selectedIndex: carouselSelectedIndex,
    pixelsPerItem: WEEK_CAROUSEL_PIXELS_PER_ITEM,
    onSelectedIndexChange: handleIndexChange,
  });

  const syncCarouselToSelectedDate = useCallback(async () => {
    if (bootstrapping) return;

    syncingDateRef.current = true;
    let index = resolveIndexForDate(selectedDate);
    if (index < 0) {
      index = await ensureDateInBuffer(selectedDate);
    }
    if (index >= 0) {
      index = await ensureBuffer(selectedDate, shiftPosition);
    }
    if (index >= 0) {
      setCarouselFallbackIndex(index);
      setIndex(index);
      notifyWeekForDate(selectedDate);
    }
    syncingDateRef.current = false;
  }, [
    bootstrapping,
    ensureBuffer,
    ensureDateInBuffer,
    notifyWeekForDate,
    resolveIndexForDate,
    selectedDate,
    setIndex,
    shiftPosition,
  ]);

  useEffect(() => {
    if (interacting || isAnimating) return;
    const syncId = ++bufferSyncRef.current;
    void (async () => {
      await syncCarouselToSelectedDate();
      if (syncId !== bufferSyncRef.current) return;
    })();
  }, [interacting, isAnimating, selectedDate, days.length, syncCarouselToSelectedDate]);

  const navigateByCalendarDay = useCallback(
    (delta: number) => {
      stopMomentum();
      stopSnap();
      const target = addCalendarDays(selectedDate, delta);
      onSelectDate(target);
    },
    [onSelectDate, selectedDate, stopMomentum, stopSnap],
  );

  const focusedIndex = Math.round(position);

  const renderEntry = (entry: WeekCarouselDayEntry, index: number) => {
    const offset = index - position;
    if (Math.abs(offset) > WEEK_CAROUSEL_VISIBLE_RANGE) return null;

    const itemStyle = coverFlowItemStyle(
      offset,
      interacting,
      WEEK_CAROUSEL_VISIBLE_RANGE,
      WEEK_CAROUSEL_TRANSLATE_X_PERCENT,
    );
    const showDetail = index === focusedIndex;
    const selectable = isCalendarDateOnOrAfter(entry.day.date, today);
    const record =
      liveWeek?.weekStart === entry.weekStart
        ? liveWeek.weekRecords.find((row) => row.date === entry.day.date)
        : entry.record;

    return (
      <div
        key={entry.day.date}
        className={`absolute left-1/2 top-1/2 ${
          selectable && !isAnimating ? "cursor-pointer" : "pointer-events-none"
        } ${interacting ? "" : "transition-transform duration-300"}`}
        style={{
          ...itemStyle,
          transformStyle: "preserve-3d",
        }}
        onClick={() => {
          if (!selectable || isAnimating) return;
          setIndex(index);
        }}
        role={selectable ? "button" : undefined}
        tabIndex={selectable && showDetail ? 0 : -1}
        onKeyDown={(event) => {
          if (!selectable || isAnimating || event.key !== "Enter") return;
          setIndex(index);
        }}
      >
        <WeekScheduleDayCell
          day={entry.day}
          weekRecords={record ? [record] : []}
          today={today}
          weekEnd={entry.weekEnd}
          showDetail={showDetail}
          conductorLabels={conductorLabels}
          vipLabels={vipLabels}
          templateShortLabels={templateShortLabels}
          layout="carousel"
        />
      </div>
    );
  };

  return (
    <div className={`flex flex-col gap-2 ${bootstrapping ? "opacity-50" : ""}`}>
      <div
        className="relative touch-none select-none overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117]/40"
        style={{ height: `${WEEK_CAROUSEL_VIEWPORT_HEIGHT_PX}px` }}
      >
        <div
          className="relative mx-auto h-full w-full"
          style={{ perspective: "800px" }}
          {...viewportHandlers}
        >
          {days.map(renderEntry)}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => navigateByCalendarDay(-1)}
          aria-label={navLabels.previousDay ?? "Previous day"}
          className="rounded px-2 py-1 text-xs text-[#8b949e] hover:text-[#e6edf3]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => navigateByCalendarDay(1)}
          aria-label={navLabels.nextDay ?? "Next day"}
          className="rounded px-2 py-1 text-xs text-[#8b949e] hover:text-[#e6edf3]"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function WeekScheduleStrip({
  today,
  initialWeekStart,
  initialWeekEnd,
  initialDayConfigs,
  initialWeekRecords,
  selectedDate,
  conductorLabels,
  vipLabels,
  templateShortLabels,
  navLabels,
  externalWeek,
  onSelectDate,
  onWeekChange,
  onWeekLoadError,
}: Props) {
  const [viewWeekStart, setViewWeekStart] = useState(initialWeekStart);
  const [page, setPage] = useState<WeekSchedulePagePayload>({
    weekStart: initialWeekStart,
    weekEnd: initialWeekEnd,
    templateType: externalWeek?.templateType ?? null,
    dayConfigs: initialDayConfigs,
    weekRecords: initialWeekRecords,
  });
  const [loading, setLoading] = useState(false);
  const selectedWeekRange = weekRangeForDate(selectedDate);
  const [carouselWeekStart, setCarouselWeekStart] = useState(
    selectedWeekRange.weekStart,
  );
  const [carouselWeekEnd, setCarouselWeekEnd] = useState(selectedWeekRange.weekEnd);
  const [mobileSeedPage] = useState<WeekSchedulePagePayload>(() => ({
    weekStart: initialWeekStart,
    weekEnd: initialWeekEnd,
    templateType: externalWeek?.templateType ?? null,
    dayConfigs: initialDayConfigs,
    weekRecords: initialWeekRecords,
  }));

  const handleCarouselWeekLabelChange = useCallback(
    (weekStart: string, weekEnd: string) => {
      setCarouselWeekStart(weekStart);
      setCarouselWeekEnd(weekEnd);
    },
    [],
  );

  useEffect(() => {
    if (!externalWeek) return;
    if (externalWeek.weekStart === viewWeekStart) return;
    const id = setTimeout(() => {
      setViewWeekStart(externalWeek.weekStart);
      setPage(externalWeek);
    }, 0);
    return () => clearTimeout(id);
  }, [externalWeek, viewWeekStart]);
  const applyPage = useCallback(
    (next: WeekSchedulePagePayload) => {
      setViewWeekStart(next.weekStart);
      setPage(next);
      onWeekChange?.(next);
    },
    [onWeekChange],
  );

  const loadWeek = useCallback(
    async (weekStart: string) => {
      if (weekStart === initialWeekStart) {
        applyPage(
          externalWeek?.weekStart === initialWeekStart
            ? externalWeek
            : {
                weekStart: initialWeekStart,
                weekEnd: initialWeekEnd,
                templateType: null,
                dayConfigs: initialDayConfigs,
                weekRecords: initialWeekRecords,
              },
        );
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `/api/trains/schedule/week?weekStart=${encodeURIComponent(weekStart)}`,
        );
        const body = (await res.json()) as WeekSchedulePagePayload & {
          error?: string;
        };
        if (!res.ok) {
          onWeekLoadError?.(body.error ?? "Could not load week.");
          return;
        }
        applyPage(body);
      } catch {
        onWeekLoadError?.("Could not load week.");
      } finally {
        setLoading(false);
      }
    },
    [
      applyPage,
      externalWeek,
      initialWeekStart,
      initialWeekEnd,
      initialDayConfigs,
      initialWeekRecords,
      onWeekLoadError,
    ],
  );

  const shiftWeek = (direction: -1 | 1) => {
    const nextStart = addCalendarDays(viewWeekStart, direction * 7);
    void loadWeek(nextStart);
  };

  const resolvedPage =
    page.dayConfigs.length > 0
      ? page
      : buildProvisionalWeekPage(viewWeekStart, page.templateType);

  const displayPage =
    externalWeek &&
    externalWeek.weekStart === resolvedPage.weekStart &&
    externalWeek.dayConfigs.length > 0
      ? externalWeek
      : resolvedPage;
  const { weekEnd, dayConfigs, weekRecords } = displayPage;

  const dayGrid = (
    <div
      className={`hidden grid-cols-7 gap-1.5 week-schedule-grid:grid ${loading ? "opacity-50" : ""}`}
    >
      {dayConfigs.map((day) => {
        const isSelected = day.date === selectedDate;
        const selectable =
          isCalendarDateOnOrAfter(day.date, today) &&
          isCalendarDateOnOrAfter(weekEnd, day.date);

        return (
          <WeekScheduleDayCell
            key={day.id}
            day={day}
            weekRecords={weekRecords}
            today={today}
            weekEnd={weekEnd}
            showDetail={isSelected}
            conductorLabels={conductorLabels}
            vipLabels={vipLabels}
            templateShortLabels={templateShortLabels}
            className="aspect-square min-w-0 p-1.5 min-h-0 w-auto"
            onSelect={selectable ? () => onSelectDate(day.date) : undefined}
          />
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-xs font-medium tabular-nums text-[#8b949e] week-schedule-grid:hidden">
        {formatWeekRange(carouselWeekStart, carouselWeekEnd)}
      </p>

      <div className="hidden items-center justify-between gap-2 week-schedule-grid:flex">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          disabled={loading}
          aria-label={navLabels.previousWeek}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-0 truncate text-center text-xs font-medium tabular-nums text-[#8b949e]">
          {formatWeekRange(displayPage.weekStart, weekEnd)}
        </span>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          disabled={loading}
          aria-label={navLabels.nextWeek}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-50"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="week-schedule-grid:hidden">
        <WeekScheduleInfiniteDayCarousel
          seedPage={mobileSeedPage}
          liveWeek={displayPage}
          today={today}
          selectedDate={selectedDate}
          conductorLabels={conductorLabels}
          vipLabels={vipLabels}
          templateShortLabels={templateShortLabels}
          navLabels={navLabels}
          onSelectDate={onSelectDate}
          onWeekChange={onWeekChange}
          onWeekLoadError={onWeekLoadError}
          onCarouselWeekLabelChange={handleCarouselWeekLabelChange}
        />
      </div>

      {dayGrid}
    </div>
  );
}

export function canSpinConductor(
  mechanism: string | null | undefined,
  locked: boolean,
  paintTemplate?: WeekTemplateType | null,
): boolean {
  return canSpinConductorForDay(mechanism, locked, paintTemplate);
}

export function canSpinVip(
  mechanism: string | null | undefined,
  locked: boolean,
): boolean {
  return canSpinVipForDay(mechanism, locked);
}
