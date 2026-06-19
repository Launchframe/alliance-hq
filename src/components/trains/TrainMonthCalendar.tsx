"use client";

import type { MouseEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type {
  MonthSchedulePagePayload,
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
} from "@/lib/trains/load-dashboard";
import {
  addCalendarDays,
  addCalendarMonths,
  buildMonthGrid,
  monthEndFromKey,
  monthStartFromKey,
} from "@/lib/trains/game-time";
import {
  TEMPLATE_PALETTE_STYLES,
  mechanismStyleClass,
} from "@/lib/trains/mechanism-styles";
import type { WeekTemplateType } from "@/lib/trains/types";

const PAINT_TEMPLATES: WeekTemplateType[] = [
  "vs_push_week",
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
  onPaintError?: (message: string) => void;
  onPainted?: () => void;
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

function expandPaintRange(from: string, to: string): string[] {
  if (from === to) return [from];
  const dates: string[] = [];
  const step = from <= to ? 1 : -1;
  let cursor = from;
  while (true) {
    dates.push(cursor);
    if (cursor === to) break;
    cursor = addCalendarDays(cursor, step);
  }
  return dates;
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
  onPaintError,
  onPainted,
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
  const [painting, setPainting] = useState(false);
  const [paintBrush, setPaintBrush] = useState<WeekTemplateType | null>(null);
  const rangeAnchorRef = useRef<string | null>(null);

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

  const paintDates = async (dates: string[], templateType: WeekTemplateType) => {
    setPainting(true);
    try {
      const res = await fetch("/api/trains/schedule/days", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates, templateType }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        onPaintError?.(body.error ?? "Could not paint days.");
        return;
      }
      await loadMonth(viewMonthKey);
      onPainted?.();
    } catch {
      onPaintError?.("Could not paint days.");
    } finally {
      setPainting(false);
    }
  };

  const handleDayClick = (
    date: string,
    inMonth: boolean,
    event: MouseEvent,
  ) => {
    if (!inMonth) return;

    if (canPaint && paintBrush) {
      const dates = event.shiftKey && rangeAnchorRef.current
        ? expandPaintRange(rangeAnchorRef.current, date)
        : [date];
      rangeAnchorRef.current = date;
      void paintDates(dates, paintBrush);
      return;
    }

    rangeAnchorRef.current = date;
    onSelectDate(date);
  };

  const displayPage =
    externalMonth?.monthKey === page.monthKey ? externalMonth : page;
  const { dayConfigs, monthRecords } = displayPage;
  const grid = buildMonthGrid(displayPage.monthKey);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void loadMonth(addCalendarMonths(viewMonthKey, -1))}
          disabled={loading || painting}
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
          disabled={loading || painting}
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
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-sm ${palette.swatch}`}
                    aria-hidden
                  />
                  {templateLabels[template] ?? template}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        className={`transition-opacity ${loading || painting ? "opacity-50" : ""}`}
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

        <div className="grid grid-cols-7 gap-1">
          {grid.map(({ date, inMonth }) => {
            const day = configForDate(dayConfigs, date);
            const record = recordForDate(monthRecords, date);
            const isSelected = date === selectedDate;
            const isToday = date === today;
            const locked = Boolean(record?.lockedAt);
            const style = mechanismStyleClass(
              day?.conductorMechanism ?? "custom",
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

            const ringClass = isSelected
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
                onClick={(event) => handleDayClick(date, inMonth, event)}
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
