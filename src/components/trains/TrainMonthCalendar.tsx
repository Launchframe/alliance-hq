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
  buildMonthGrid,
  getMonthKey,
  monthEndFromKey,
  monthStartFromKey,
} from "@/lib/trains/game-time";
import { expandPaintRange } from "@/lib/trains/paint-range.shared";
import { calendarCellStyleClass } from "@/lib/trains/calendar-cell-styles.shared";
import { TemplatePaletteBadge } from "@/components/trains/TemplatePaletteBadge";
import {
  TEMPLATE_PALETTE_STYLES,
} from "@/lib/trains/mechanism-styles";
import type { WeekTemplateType } from "@/lib/trains/types";

const PAINT_TEMPLATES: WeekTemplateType[] = [
  "vs_push_week",
  "vs_push_weekdays",
  "r4_event_vip",
  "economy_week",
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
  const [paintBrush, setPaintBrush] = useState<WeekTemplateType | null>(null);
  const [dragRange, setDragRange] = useState<{
    anchor: string;
    focus: string;
  } | null>(null);
  const rangeAnchorRef = useRef<string | null>(null);
  const paintDragActiveRef = useRef(false);
  const dragRangeRef = useRef<{ anchor: string; focus: string } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const paintBrushRef = useRef(paintBrush);
  const onPaintDatesRef = useRef(onPaintDates);
  useEffect(() => {
    paintBrushRef.current = paintBrush;
    onPaintDatesRef.current = onPaintDates;
  }, [onPaintDates, paintBrush]);

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

  const paintMode = Boolean(canPaint && paintBrush && onPaintDates);

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

  const resetPaintDrag = useCallback(() => {
    paintDragActiveRef.current = false;
    dragRangeRef.current = null;
    setDragRange(null);
  }, []);

  const updateDragFocus = useCallback((date: string) => {
    if (!dragRangeRef.current || dragRangeRef.current.focus === date) return;
    const next = { ...dragRangeRef.current, focus: date };
    dragRangeRef.current = next;
    setDragRange(next);
  }, []);

  const commitPaintRange = useCallback(
    (anchor: string, focus: string, shiftKey: boolean) => {
      const brush = paintBrushRef.current;
      const paint = onPaintDatesRef.current;
      if (!brush || !paint) return;

      const rangeAnchor = rangeAnchorRef.current ?? selectedDate;
      const dates =
        shiftKey && anchor === focus
          ? expandPaintRange(rangeAnchor, focus)
          : expandPaintRange(anchor, focus);

      rangeAnchorRef.current = focus;
      paint(dates, brush);
    },
    [selectedDate],
  );

  const handlePaintPointerDown = useCallback(
    (date: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!paintMode) return;

      event.preventDefault();

      paintDragActiveRef.current = true;
      const next = { anchor: date, focus: date };
      dragRangeRef.current = next;
      setDragRange(next);

      const pointerId = event.pointerId;
      let committed = false;

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId || !paintDragActiveRef.current) return;
        const hit = resolvePaintDate(e.clientX, e.clientY);
        if (hit) updateDragFocus(hit);
      };

      const finish = (e: PointerEvent) => {
        if (e.pointerId !== pointerId || committed) return;
        committed = true;

        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", finish, true);
        window.removeEventListener("pointercancel", finish, true);

        if (!paintDragActiveRef.current || !dragRangeRef.current) return;

        const { anchor, focus } = dragRangeRef.current;
        commitPaintRange(anchor, focus, e.shiftKey);
        resetPaintDrag();
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", finish, true);
      window.addEventListener("pointercancel", finish, true);
    },
    [
      paintMode,
      resolvePaintDate,
      updateDragFocus,
      commitPaintRange,
      resetPaintDrag,
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
  const grid = buildMonthGrid(displayPage.monthKey);
  const previewDates = useMemo(() => {
    if (!dragRange) return null;
    return new Set(
      expandPaintRange(dragRange.anchor, dragRange.focus),
    );
  }, [dragRange]);
  const previewRingClass = paintBrush
    ? TEMPLATE_PALETTE_STYLES[paintBrush].ring
    : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void loadMonth(addCalendarMonths(viewMonthKey, -1))}
          disabled={loading}
          aria-label={navLabels.previousMonth}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-0 truncate text-center text-sm font-medium tabular-nums text-[#e6edf3]">
          {formatMonthLabel(displayPage.monthKey)}
        </span>
        <button
          type="button"
          onClick={() => void loadMonth(addCalendarMonths(viewMonthKey, 1))}
          disabled={loading}
          aria-label={navLabels.nextMonth}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-50"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {canPaint ? (
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117]/60 p-3">
          <p className="text-xs font-medium text-[#8b949e]">
            {navLabels.paletteTitle}
          </p>
          <p className="mt-0.5 text-[10px] text-[#6e7681]">
            {navLabels.paletteHint}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PAINT_TEMPLATES.map((template) => {
              const active = paintBrush === template;
              const palette = TEMPLATE_PALETTE_STYLES[template];
              return (
                <button
                  key={template}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setPaintBrush((prev) =>
                      prev === template ? null : template,
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? `border-[#58a6ff] bg-[#161b22] text-[#e6edf3] ring-1 ${palette.ring}`
                      : "border-[#30363d] text-[#c9d1d9] hover:bg-[#161b22]"
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
              className="text-center text-[10px] font-medium uppercase tracking-wide text-[#6e7681]"
            >
              {label}
            </div>
          ))}
        </div>

        <div
          ref={gridRef}
          className={`grid grid-cols-7 gap-1 ${paintMode ? "touch-none select-none" : ""}`}
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

            const inDragPreview = Boolean(previewDates?.has(date));
            const ringClass = inDragPreview
              ? `ring-2 ring-offset-1 ring-offset-[#0d1117] ${previewRingClass}`
              : isSelected
                ? "ring-2 ring-[#58a6ff] ring-offset-1 ring-offset-[#0d1117]"
                : isToday
                  ? "ring-1 ring-[#58a6ff]/50 ring-offset-1 ring-offset-[#0d1117]"
                  : "";

            const cellClass = `flex min-h-[4.75rem] min-w-0 flex-col rounded-lg border-2 p-1 text-left ${style} ${ringClass} ${
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
                      locked ? "text-white" : "text-[#8b949e]"
                    }`}
                    title={conductorName}
                  >
                    {conductorName}
                  </div>
                ) : null}
                {inMonth && vipName ? (
                  <div
                    className={`truncate text-[9px] leading-tight ${
                      locked ? "opacity-95" : "text-[#6e7681]"
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
                  paintMode
                    ? (event) => handlePaintPointerDown(date, event)
                    : undefined
                }
                onClick={
                  paintMode ? undefined : () => handleDaySelect(date)
                }
                aria-pressed={isSelected}
                aria-label={date}
                className={`${cellClass} hover:opacity-95`}
              >
                {inner}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
