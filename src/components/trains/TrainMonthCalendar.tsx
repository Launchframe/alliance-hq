"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  MonthSchedulePagePayload,
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
} from "@/lib/trains/load-dashboard";
import {
  addCalendarMonths,
  getMonthKey,
  monthEndFromKey,
  monthStartFromKey,
} from "@/lib/trains/game-time";
import { buildMonthGrid } from "@/lib/trains/trains-display-calendar.shared";
import type { TrainsDisplayWeekStartDow } from "@/lib/trains/trains-display-calendar.shared";
import { expandPaintRange } from "@/lib/trains/paint-range.shared";
import { calendarCellStyleClass } from "@/lib/trains/calendar-cell-styles.shared";
import {
  isProvisionalDayConfig,
  provisionalDayConfigClass,
} from "@/lib/trains/week-schedule-day-configs.shared";
import { TemplatePaletteBadge } from "@/components/trains/TemplatePaletteBadge";
import {
  TEMPLATE_PALETTE_STYLES,
} from "@/lib/trains/mechanism-styles";
import type { WeekTemplateType } from "@/lib/trains/types";

export const PAINT_TEMPLATES: WeekTemplateType[] = [
  "vs_push_week",
  "vs_push_weekdays",
  "r4_event_vip",
  "economy_week",
  "price_is_right",
  "r3_recognition",
  "r4_train_week",
  "donations_week",
  "custom",
];

type Props = {
  today: string;
  initialMonthKey: string;
  initialDayConfigs: WeekScheduleDayConfig[];
  initialMonthRecords: WeekConductorRecordSummary[];
  selectedDate: string;
  displayWeekStartDow?: TrainsDisplayWeekStartDow;
  canPaint: boolean;
  conductorLabels: Record<string, string>;
  vipLabels: Record<string, string>;
  templateLabels: Record<string, string>;
  navLabels: {
    previousMonth: string;
    nextMonth: string;
    paletteTitle: string;
    paletteHint: string;
    weekdayHeaders: string[];
    previewLegend?: string;
    draftScheduleAriaLabel?: string;
  };
  externalMonth?: MonthSchedulePagePayload;
  onSelectDate: (date: string) => void;
  onMonthChange?: (page: MonthSchedulePagePayload) => void;
  onMonthLoadError?: () => void;
  onPaintDates?: (dates: string[], template: WeekTemplateType) => void;
};

function recordForDate(
  records: WeekConductorRecordSummary[],
  date: string,
): WeekConductorRecordSummary | undefined {
  return records.find((r) => r.date === date);
}

function configForDate(
  dayConfigs: WeekScheduleDayConfig[],
  date: string,
): WeekScheduleDayConfig | undefined {
  return dayConfigs.find((d) => d.date === date);
}

function formatMonthLabel(monthKey: string): string {
  const anchor = new Date(`${monthKey}-15T12:00:00-02:00`);
  return anchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "Etc/GMT+2",
  });
}

export function TrainMonthCalendar({
  today,
  initialMonthKey,
  initialDayConfigs,
  initialMonthRecords,
  selectedDate,
  displayWeekStartDow,
  canPaint,
  conductorLabels,
  vipLabels,
  templateLabels,
  navLabels,
  externalMonth,
  onSelectDate,
  onMonthChange,
  onMonthLoadError,
  onPaintDates,
}: Props) {
  const [viewMonthKey, setViewMonthKey] = useState(initialMonthKey);
  const [page, setPage] = useState<MonthSchedulePagePayload>({
    monthKey: initialMonthKey,
    monthStart: monthStartFromKey(initialMonthKey),
    monthEnd: monthEndFromKey(initialMonthKey),
    dayConfigs: initialDayConfigs,
    monthRecords: initialMonthRecords,
  });
  const [loading, setLoading] = useState(false);
  const [selectedRange, setSelectedRange] = useState<{
    anchor: string;
    focus: string;
  } | null>(null);
  const rangeAnchorRef = useRef<string | null>(null);
  const selectionDragActiveRef = useRef(false);
  const selectedRangeRef = useRef<{ anchor: string; focus: string } | null>(
    null,
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const onPaintDatesRef = useRef(onPaintDates);
  useEffect(() => {
    onPaintDatesRef.current = onPaintDates;
  }, [onPaintDates]);

  useEffect(() => {
    selectedRangeRef.current = selectedRange;
  }, [selectedRange]);

  useEffect(() => {
    if (!externalMonth) return;
    const selectedMonthKey = getMonthKey(selectedDate);
    if (externalMonth.monthKey !== selectedMonthKey) return;

    if (
      externalMonth.monthKey === viewMonthKey &&
      externalMonth.dayConfigs === page.dayConfigs &&
      externalMonth.monthRecords === page.monthRecords
    ) {
      return;
    }

    const id = setTimeout(() => {
      setViewMonthKey(externalMonth.monthKey);
      setPage(externalMonth);
    }, 0);
    return () => clearTimeout(id);
  }, [externalMonth, page.dayConfigs, page.monthRecords, selectedDate, viewMonthKey]);

  const selectionMode = Boolean(canPaint && onPaintDates);

  const applyPage = useCallback(
    (next: MonthSchedulePagePayload) => {
      setViewMonthKey(next.monthKey);
      setPage(next);
      onMonthChange?.(next);
    },
    [onMonthChange],
  );

  const loadMonth = useCallback(
    async (monthKey: string) => {
      setSelectedRange(null);
      selectedRangeRef.current = null;
      if (monthKey === initialMonthKey) {
        applyPage({
          monthKey: initialMonthKey,
          monthStart: monthStartFromKey(initialMonthKey),
          monthEnd: monthEndFromKey(initialMonthKey),
          dayConfigs: initialDayConfigs,
          monthRecords: initialMonthRecords,
        });
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `/api/trains/schedule/month?month=${encodeURIComponent(monthKey)}`,
        );
        const body = (await res.json()) as MonthSchedulePagePayload & {
          error?: string;
        };
        if (!res.ok) {
          onMonthLoadError?.();
          return;
        }
        applyPage(body);
      } catch {
        onMonthLoadError?.();
      } finally {
        setLoading(false);
      }
    },
    [
      applyPage,
      initialDayConfigs,
      initialMonthKey,
      initialMonthRecords,
      onMonthLoadError,
    ],
  );

  const resolvePaintDate = useCallback(
    (clientX: number, clientY: number): string | null => {
      const grid = gridRef.current;
      if (!grid) return null;

      const cells = grid.querySelectorAll<HTMLElement>(
        '[data-paint-date][data-in-month="true"]',
      );
      for (const cell of cells) {
        const rect = cell.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return cell.dataset.paintDate ?? null;
        }
      }
      return null;
    },
    [],
  );

  const resetSelectionDrag = useCallback(() => {
    selectionDragActiveRef.current = false;
  }, []);

  const updateSelectionFocus = useCallback((date: string) => {
    if (!selectedRangeRef.current || selectedRangeRef.current.focus === date) {
      return;
    }
    const next = { ...selectedRangeRef.current, focus: date };
    selectedRangeRef.current = next;
    setSelectedRange(next);
  }, []);

  const commitSelectionRange = useCallback(
    (anchor: string, focus: string, shiftKey: boolean) => {
      const rangeAnchor = rangeAnchorRef.current ?? selectedDate;
      const next =
        shiftKey && anchor === focus
          ? { anchor: rangeAnchor, focus }
          : { anchor, focus };
      selectedRangeRef.current = next;
      setSelectedRange(next);
      rangeAnchorRef.current = focus;
      onSelectDate(focus);
    },
    [onSelectDate, selectedDate],
  );

  const applyTemplateToSelection = useCallback(
    (template: WeekTemplateType) => {
      const paint = onPaintDatesRef.current;
      const range = selectedRangeRef.current;
      if (!paint || !range) return;
      const dates = expandPaintRange(range.anchor, range.focus);
      if (dates.length === 0) return;
      paint(dates, template);
    },
    [],
  );

  const handleSelectionPointerDown = useCallback(
    (date: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!selectionMode) return;

      event.preventDefault();

      selectionDragActiveRef.current = true;
      const next = { anchor: date, focus: date };
      selectedRangeRef.current = next;
      setSelectedRange(next);

      const pointerId = event.pointerId;
      let committed = false;

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId || !selectionDragActiveRef.current) {
          return;
        }
        const hit = resolvePaintDate(e.clientX, e.clientY);
        if (hit) updateSelectionFocus(hit);
      };

      const finish = (e: PointerEvent) => {
        if (e.pointerId !== pointerId || committed) return;
        committed = true;

        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", finish, true);
        window.removeEventListener("pointercancel", finish, true);

        if (!selectionDragActiveRef.current || !selectedRangeRef.current) {
          return;
        }

        const { anchor, focus } = selectedRangeRef.current;
        commitSelectionRange(anchor, focus, e.shiftKey);
        resetSelectionDrag();
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", finish, true);
      window.addEventListener("pointercancel", finish, true);
    },
    [
      selectionMode,
      resolvePaintDate,
      updateSelectionFocus,
      commitSelectionRange,
      resetSelectionDrag,
    ],
  );

  const handleDaySelect = useCallback(
    (date: string) => {
      rangeAnchorRef.current = date;
      onSelectDate(date);
    },
    [onSelectDate],
  );

  const displayPage =
    externalMonth?.monthKey === page.monthKey ? externalMonth : page;
  const { dayConfigs, monthRecords } = displayPage;
  const grid = buildMonthGrid(displayPage.monthKey, displayWeekStartDow);
  const selectionPreviewDates = useMemo(() => {
    if (!selectedRange) return null;
    return new Set(
      expandPaintRange(selectedRange.anchor, selectedRange.focus),
    );
  }, [selectedRange]);
  const hasSelection = Boolean(selectedRange);
  const hasProvisionalDays = useMemo(
    () => dayConfigs.some((day) => isProvisionalDayConfig(day.id)),
    [dayConfigs],
  );
  const draftAriaSuffix = navLabels.draftScheduleAriaLabel ?? "Draft schedule";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void loadMonth(addCalendarMonths(viewMonthKey, -1))}
          disabled={loading}
          aria-label={navLabels.previousMonth}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hq-border text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-0 truncate text-center text-sm font-medium tabular-nums text-hq-fg">
          {formatMonthLabel(displayPage.monthKey)}
        </span>
        <button
          type="button"
          onClick={() => void loadMonth(addCalendarMonths(viewMonthKey, 1))}
          disabled={loading}
          aria-label={navLabels.nextMonth}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hq-border text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {canPaint ? (
        <div className="rounded-xl border border-hq-border bg-hq-canvas/60 p-3">
          <p className="text-xs font-medium text-hq-fg-muted">
            {navLabels.paletteTitle}
          </p>
          <p className="mt-0.5 text-[10px] text-hq-fg-subtle">
            {navLabels.paletteHint}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PAINT_TEMPLATES.map((template) => {
              const palette = TEMPLATE_PALETTE_STYLES[template];
              return (
                <button
                  key={template}
                  type="button"
                  disabled={!hasSelection}
                  onClick={() => applyTemplateToSelection(template)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    hasSelection
                      ? `border-hq-border text-[#c9d1d9] hover:bg-hq-surface hover:ring-1 ${palette.ring}`
                      : "border-hq-border text-[#c9d1d9]"
                  }`}
                >
                  <TemplatePaletteBadge template={template} shape="square" />
                  {templateLabels[template] ?? template}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        className={`transition-opacity ${loading ? "opacity-50" : ""}`}
      >
        <div className="mb-1 grid grid-cols-7 gap-1">
          {navLabels.weekdayHeaders.map((label) => (
            <div
              key={label}
              className="text-center text-[10px] font-medium uppercase tracking-wide text-hq-fg-subtle"
            >
              {label}
            </div>
          ))}
        </div>

        <div
          ref={gridRef}
          className={`grid grid-cols-7 gap-1 ${selectionMode ? "touch-none select-none" : ""}`}
        >
          {grid.map(({ date, inMonth }) => {
            const day = configForDate(dayConfigs, date);
            const record = recordForDate(monthRecords, date);
            const isSelected = date === selectedDate;
            const isToday = date === today;
            const locked = Boolean(record?.lockedAt);
            const style = calendarCellStyleClass(
              day?.conductorMechanism ?? "custom",
              day?.paintTemplate,
            );
            const conductorName = record?.conductorMemberName;
            const vipName = record?.vipMemberName;
            const dayNumber = date.slice(8);
            const mechLabel = day
              ? (conductorLabels[day.conductorMechanism] ??
                day.conductorMechanism)
              : null;
            const vipLabel =
              day?.vipMechanism && day.vipMechanism !== "none"
                ? (vipLabels[day.vipMechanism] ?? day.vipMechanism)
                : null;

            const inSelectionPreview = Boolean(selectionPreviewDates?.has(date));
            const ringClass = inSelectionPreview
              ? "ring-2 ring-[#d29922] ring-offset-1 ring-offset-hq-canvas"
              : isSelected
                ? "ring-2 ring-hq-accent ring-offset-1 ring-offset-hq-canvas"
                : isToday
                  ? "ring-1 ring-hq-accent/50 ring-offset-1 ring-offset-hq-canvas"
                  : "";

            const isProvisional = day ? isProvisionalDayConfig(day.id) : false;
            const cellClass = `flex min-h-[4.75rem] min-w-0 flex-col rounded-lg border-2 p-1 text-left ${style} ${ringClass} ${provisionalDayConfigClass(isProvisional)} ${
              inMonth ? "opacity-100" : "pointer-events-none opacity-25"
            }`;

            const inner = (
              <>
                <div className="flex items-start justify-between gap-0.5">
                  <span className="text-xs font-semibold tabular-nums">
                    {dayNumber}
                  </span>
                  {day?.isOverride ? (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f0883e]"
                      title="Override"
                    />
                  ) : null}
                </div>
                {inMonth && mechLabel ? (
                  <div className="truncate text-[9px] font-bold uppercase leading-tight opacity-90">
                    {mechLabel}
                    {vipLabel ? ` · ${vipLabel}` : ""}
                  </div>
                ) : null}
                {inMonth && conductorName ? (
                  <div
                    className={`truncate text-[10px] font-bold leading-tight ${
                      locked ? "text-white" : "text-hq-fg-muted"
                    }`}
                    title={conductorName}
                  >
                    {conductorName}
                  </div>
                ) : null}
                {inMonth && vipName ? (
                  <div
                    className={`truncate text-[9px] leading-tight ${
                      locked ? "opacity-95" : "text-hq-fg-subtle"
                    }`}
                    title={vipName}
                  >
                    {vipName}
                  </div>
                ) : null}
              </>
            );

            if (!inMonth) {
              return (
                <div key={date} className={cellClass} aria-hidden>
                  {inner}
                </div>
              );
            }

            return (
              <button
                key={date}
                type="button"
                data-paint-date={date}
                data-in-month="true"
                onPointerDown={
                  selectionMode
                    ? (event) => handleSelectionPointerDown(date, event)
                    : undefined
                }
                onClick={
                  selectionMode ? undefined : () => handleDaySelect(date)
                }
                aria-pressed={isSelected}
                aria-label={
                  isProvisional ? `${date}, ${draftAriaSuffix}` : date
                }
                className={`${cellClass} hover:opacity-95`}
              >
                {inner}
              </button>
            );
          })}
        </div>
      </div>

      {hasProvisionalDays && navLabels.previewLegend ? (
        <p className="text-[11px] leading-relaxed text-hq-fg-subtle">
          {navLabels.previewLegend}
        </p>
      ) : null}
    </div>
  );
}
