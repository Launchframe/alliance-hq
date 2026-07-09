"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";
import {
  addCalendarMonths,
  getMonthKey,
} from "@/lib/trains/game-time";
import { groupEventsByServerDate } from "@/lib/battle-plan/display.shared";
import {
  buildMonthGrid,
} from "@/lib/trains/trains-display-calendar.shared";

type Props = {
  events: SerializedCaptureEvent[];
  todayServerDate: string;
  canWrite: boolean;
  onSelectDate?: (serverDate: string) => void;
  onSelectEvent?: (event: SerializedCaptureEvent) => void;
};

export function BattlePlanCalendar({
  events,
  todayServerDate,
  canWrite,
  onSelectDate,
  onSelectEvent,
}: Props) {
  const t = useTranslations("battlePlan");
  const [monthKey, setMonthKey] = useState(getMonthKey(todayServerDate));
  const grouped = useMemo(() => groupEventsByServerDate(events), [events]);
  const grid = useMemo(() => buildMonthGrid(monthKey), [monthKey]);

  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          className="rounded border border-hq-border p-1 text-hq-fg-muted hover:text-hq-fg"
          onClick={() => setMonthKey((current) => addCalendarMonths(current, -1))}
          aria-label={t("calendar.previousMonth")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-semibold text-hq-fg">{monthKey}</h2>
        <button
          type="button"
          className="rounded border border-hq-border p-1 text-hq-fg-muted hover:text-hq-fg"
          onClick={() => setMonthKey((current) => addCalendarMonths(current, 1))}
          aria-label={t("calendar.nextMonth")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-hq-fg-muted">
        {t.raw("calendar.weekdayHeaders").map((label: string) => (
          <div key={label} className="py-1 font-medium">
            {label}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.map((cell) => {
          const dayEvents = grouped.get(cell.date) ?? [];
          const scheduledCount = dayEvents.filter(
            (event) => event.status === "scheduled",
          ).length;
          const isToday = cell.date === todayServerDate;
          return (
            <button
              key={cell.date}
              type="button"
              disabled={!canWrite || !onSelectDate}
              onClick={() => onSelectDate?.(cell.date)}
              className={`min-h-20 rounded border p-1 text-left text-xs ${
                cell.inMonth
                  ? "border-hq-border bg-hq-bg"
                  : "border-transparent bg-transparent text-hq-fg-subtle"
              } ${isToday ? "ring-1 ring-hq-accent" : ""} ${
                canWrite && onSelectDate && cell.inMonth
                  ? "hover:border-hq-accent"
                  : ""
              }`}
            >
              <div className="font-medium text-hq-fg">{cell.date.slice(-2)}</div>
              {scheduledCount > 0 ? (
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 2).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onSelectEvent?.(event);
                      }}
                      className="block w-full truncate rounded bg-hq-accent/15 px-1 py-0.5 text-[10px] text-hq-fg"
                    >
                      #{event.markerNumber}{" "}
                      {event.territoryType === "stronghold" ? "SH" : "C"}
                    </button>
                  ))}
                  {scheduledCount > 2 ? (
                    <div className="text-[10px] text-hq-fg-muted">
                      {t("calendar.more", { count: scheduledCount - 2 })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
