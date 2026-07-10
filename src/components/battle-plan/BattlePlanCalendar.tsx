"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
import type {
  SerializedBattlePlanMarker,
  SerializedCaptureEvent,
} from "@/lib/battle-plan/types.shared";
import {
  addCalendarMonths,
  getMonthKey,
} from "@/lib/trains/game-time";
import {
  formatLocalCaptureTime,
  groupEventsByServerDate,
} from "@/lib/battle-plan/display.shared";
import { capturePolicyBarClassName } from "@/lib/battle-plan/marker-colors.shared";
import {
  buildMonthGrid,
} from "@/lib/trains/trains-display-calendar.shared";

type Props = {
  events: SerializedCaptureEvent[];
  markers: SerializedBattlePlanMarker[];
  todayServerDate: string;
  canWrite: boolean;
  onSelectDate?: (serverDate: string) => void;
  onSelectEvent?: (event: SerializedCaptureEvent) => void;
};

export function BattlePlanCalendar({
  events,
  markers,
  todayServerDate,
  canWrite,
  onSelectDate,
  onSelectEvent,
}: Props) {
  const t = useTranslations("battlePlan");
  const [monthKey, setMonthKey] = useState(getMonthKey(todayServerDate));
  const grouped = useMemo(() => groupEventsByServerDate(events), [events]);
  const grid = useMemo(() => buildMonthGrid(monthKey), [monthKey]);
  const markerColors = useMemo(
    () => new Map(markers.map((marker) => [marker.markerNumber, marker.colorHex])),
    [markers],
  );

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
          const scheduledEvents = dayEvents.filter(
            (event) => event.status === "scheduled",
          );
          const isToday = cell.date === todayServerDate;
          const daySelectable =
            canWrite && onSelectDate != null && cell.inMonth;
          return (
            <div
              key={cell.date}
              role={daySelectable ? "button" : undefined}
              tabIndex={daySelectable ? 0 : undefined}
              onClick={
                daySelectable
                  ? () => onSelectDate(cell.date)
                  : undefined
              }
              onKeyDown={
                daySelectable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectDate(cell.date);
                      }
                    }
                  : undefined
              }
              className={`min-h-24 rounded border p-1 text-left text-xs ${
                cell.inMonth
                  ? "border-hq-border bg-hq-bg"
                  : "border-transparent bg-transparent text-hq-fg-subtle"
              } ${isToday ? "ring-1 ring-hq-accent" : ""} ${
                daySelectable ? "cursor-pointer hover:border-hq-accent" : ""
              }`}
            >
              <div className="font-medium text-hq-fg">{cell.date.slice(-2)}</div>
              {scheduledEvents.length > 0 ? (
                <div className="mt-1 space-y-1">
                  {scheduledEvents.slice(0, 3).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onSelectEvent?.(event);
                      }}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium ${capturePolicyBarClassName(event.effectiveCapturePolicy)}`}
                    >
                      <MarkerBadge
                        markerNumber={event.markerNumber}
                        colorHex={
                          markerColors.get(event.markerNumber) ?? "#64748b"
                        }
                        size="sm"
                      />
                      <span className="truncate">
                        {formatLocalCaptureTime(event.scheduledAt)}
                        {" · "}
                        {event.territoryType === "stronghold" ? "SH" : "C"}
                      </span>
                    </button>
                  ))}
                  {scheduledEvents.length > 3 ? (
                    <div className="text-[10px] text-hq-fg-muted">
                      {t("calendar.more", { count: scheduledEvents.length - 3 })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
