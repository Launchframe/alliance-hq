"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";

import type {
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import { addCalendarDays, isCalendarDateOnOrAfter } from "@/lib/trains/game-time";
import { mechanismStyleClass } from "@/lib/trains/mechanism-styles";
import { mechanismNeedsWheel } from "@/lib/trains/templates";

type Props = {
  today: string;
  initialWeekStart: string;
  initialWeekEnd: string;
  initialDayConfigs: WeekScheduleDayConfig[];
  initialWeekRecords: WeekConductorRecordSummary[];
  selectedDate: string;
  conductorLabels: Record<string, string>;
  vipLabels: Record<string, string>;
  navLabels: {
    previousWeek: string;
    nextWeek: string;
  };
  externalWeek?: WeekSchedulePagePayload;
  onSelectDate: (date: string) => void;
  onWeekChange?: (page: WeekSchedulePagePayload) => void;
  onWeekLoadError?: (message: string) => void;
};

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

export function WeekScheduleStrip({
  today,
  initialWeekStart,
  initialWeekEnd,
  initialDayConfigs,
  initialWeekRecords,
  selectedDate,
  conductorLabels,
  vipLabels,
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
    dayConfigs: initialDayConfigs,
    weekRecords: initialWeekRecords,
  });
  const [loading, setLoading] = useState(false);

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
        applyPage({
          weekStart: initialWeekStart,
          weekEnd: initialWeekEnd,
          dayConfigs: initialDayConfigs,
          weekRecords: initialWeekRecords,
        });
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

  if (page.dayConfigs.length === 0) {
    return null;
  }

  const displayPage =
    externalWeek?.weekStart === page.weekStart ? externalWeek : page;
  const { weekEnd, dayConfigs, weekRecords } = displayPage;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
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

      <div
        className={`grid grid-cols-7 gap-1.5 transition-opacity ${loading ? "opacity-50" : ""}`}
      >
        {dayConfigs.map((day) => {
          const isSelected = day.date === selectedDate;
          const isToday = day.date === today;
          const selectable =
            isCalendarDateOnOrAfter(day.date, today) &&
            isCalendarDateOnOrAfter(weekEnd, day.date);
          const style = mechanismStyleClass(day.conductorMechanism);
          const weekday = new Date(`${day.date}T12:00:00-02:00`).toLocaleDateString(
            undefined,
            { weekday: "short", timeZone: "Etc/GMT+2" },
          );
          const vipLabel =
            day.vipMechanism && day.vipMechanism !== "none"
              ? (vipLabels[day.vipMechanism] ?? day.vipMechanism)
              : null;

          const record = recordForDate(weekRecords, day.date);
          const locked = Boolean(record?.lockedAt);
          const conductorName = record?.conductorMemberName;
          const vipName = record?.vipMemberName;

          const cellInner = (
            <>
              <div className="min-w-0">
                <div className="truncate text-[10px] font-medium uppercase tracking-wide opacity-80">
                  {weekday}
                </div>
                <div className="text-xs font-semibold tabular-nums">
                  {day.date.slice(5)}
                </div>
              </div>
              <div className="min-w-0 space-y-0.5">
                {!isSelected ? (
                  <>
                    <div className="truncate text-[10px] font-bold uppercase leading-tight">
                      {conductorLabels[day.conductorMechanism] ??
                        day.conductorMechanism}
                    </div>
                    {vipLabel ? (
                      <div className="truncate text-[9px] font-medium uppercase leading-tight opacity-90">
                        {vipLabel}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="truncate text-[9px] font-medium uppercase leading-tight opacity-75">
                      {conductorLabels[day.conductorMechanism] ??
                        day.conductorMechanism}
                      {vipLabel ? ` · ${vipLabel}` : ""}
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

          const ringClass = isSelected
            ? "ring-2 ring-[#58a6ff] ring-offset-1 ring-offset-[#0d1117]"
            : isToday
              ? "ring-1 ring-[#58a6ff]/50 ring-offset-1 ring-offset-[#0d1117]"
              : "";

          if (selectable) {
            return (
              <button
                key={day.id}
                type="button"
                onClick={() => onSelectDate(day.date)}
                aria-pressed={isSelected}
                aria-label={`${weekday} ${day.date.slice(5)}`}
                className={`flex aspect-square min-w-0 flex-col justify-between rounded-lg border-2 p-1.5 text-left transition-opacity hover:opacity-95 ${ringClass} ${style}`}
              >
                {cellInner}
              </button>
            );
          }

          return (
            <div
              key={day.id}
              className={`flex aspect-square min-w-0 flex-col justify-between rounded-lg border-2 p-1.5 opacity-60 ${ringClass} ${style}`}
            >
              {cellInner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function canSpinConductor(
  mechanism: string | null | undefined,
  locked: boolean,
): boolean {
  if (locked || !mechanism) return false;
  if (mechanism === "vs_high_score" || mechanism === "donations_top") {
    return false;
  }
  return mechanismNeedsWheel(
    mechanism as Parameters<typeof mechanismNeedsWheel>[0],
  );
}

export function canSpinVip(
  mechanism: string | null | undefined,
  locked: boolean,
): boolean {
  if (locked || !mechanism) return false;
  return (
    mechanism === "donations_second" || mechanism === "event_top_x_lottery"
  );
}
