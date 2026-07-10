"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
import {
  buildDailyGrid,
  formatDailyRangeLabel,
} from "@/lib/battle-plan/calendar-view.shared";
import {
  formatLocalCaptureTime,
  groupEventsByServerDate,
} from "@/lib/battle-plan/display.shared";
import { capturePolicyBarClassName } from "@/lib/battle-plan/marker-colors.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";
import { addCalendarDays, getServerDayOfWeek } from "@/lib/trains/game-time";

type Props = {
  events: SerializedCaptureEvent[];
  todayServerDate: string;
  canWrite: boolean;
  onSelectDate?: (serverDate: string) => void;
  onSelectEvent?: (event: SerializedCaptureEvent) => void;
};

function DayCell({
  date,
  weekdayLabel,
  scheduledEvents,
  isToday,
  canWrite,
  onSelectDate,
  onSelectEvent,
  t,
}: {
  date: string;
  weekdayLabel: string;
  scheduledEvents: SerializedCaptureEvent[];
  isToday: boolean;
  canWrite: boolean;
  onSelectDate?: (serverDate: string) => void;
  onSelectEvent?: (event: SerializedCaptureEvent) => void;
  t: ReturnType<typeof useTranslations<"battlePlan">>;
}) {
  const daySelectable = canWrite && onSelectDate != null;
  const territoryLabel = (event: SerializedCaptureEvent) =>
    event.territoryType === "stronghold"
      ? t("event.stronghold")
      : t("event.city");

  return (
    <div
      role={daySelectable ? "button" : undefined}
      tabIndex={daySelectable ? 0 : undefined}
      onClick={daySelectable ? () => onSelectDate(date) : undefined}
      onKeyDown={
        daySelectable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectDate(date);
              }
            }
          : undefined
      }
      className={`min-h-32 rounded border border-hq-border bg-hq-bg p-2 text-left sm:min-h-40 ${
        isToday ? "ring-2 ring-hq-accent" : ""
      } ${daySelectable ? "cursor-pointer hover:border-hq-accent" : ""}`}
    >
      <div className="text-sm font-medium text-hq-fg">
        {weekdayLabel} {date.slice(-2)}
      </div>
      {scheduledEvents.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {scheduledEvents.slice(0, 8).map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                onSelectEvent?.(event);
              }}
              className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium ${capturePolicyBarClassName(event.effectiveCapturePolicy)}`}
            >
              {event.iconPreset ? (
                <MarkerBadge iconPreset={event.iconPreset} size="sm" />
              ) : null}
              <span className="text-left">
                {formatLocalCaptureTime(event.scheduledAt)}
                {" · "}
                {territoryLabel(event)}
              </span>
            </button>
          ))}
          {scheduledEvents.length > 8 ? (
            <div className="text-[10px] text-hq-fg-muted">
              {t("calendar.more", { count: scheduledEvents.length - 8 })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BattlePlanCalendar({
  events,
  todayServerDate,
  canWrite,
  onSelectDate,
  onSelectEvent,
}: Props) {
  const t = useTranslations("battlePlan");
  const weekdayHeaders = t.raw("calendar.weekdayHeaders") as string[];
  const [anchorDate, setAnchorDate] = useState(todayServerDate);
  const grouped = useMemo(() => groupEventsByServerDate(events), [events]);
  const dailyGrid = useMemo(() => buildDailyGrid(anchorDate), [anchorDate]);

  const weekdayLabel = (date: string) => weekdayHeaders[getServerDayOfWeek(date)];

  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="mb-4 flex items-center justify-center gap-2">
        <button
          type="button"
          className="rounded border border-hq-border p-1 text-hq-fg-muted hover:text-hq-fg"
          onClick={() =>
            setAnchorDate((current) => addCalendarDays(current, -1))
          }
          aria-label={t("calendar.previousDay")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="min-w-40 text-center text-sm font-semibold text-hq-fg">
          {formatDailyRangeLabel(anchorDate)}
        </h2>
        <button
          type="button"
          className="rounded border border-hq-border p-1 text-hq-fg-muted hover:text-hq-fg"
          onClick={() =>
            setAnchorDate((current) => addCalendarDays(current, 1))
          }
          aria-label={t("calendar.nextDay")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {dailyGrid.map((cell) => {
          const dayEvents = grouped.get(cell.date) ?? [];
          const scheduledEvents = dayEvents.filter(
            (event) => event.status === "scheduled",
          );
          return (
            <DayCell
              key={cell.date}
              date={cell.date}
              weekdayLabel={weekdayLabel(cell.date)}
              scheduledEvents={scheduledEvents}
              isToday={cell.date === todayServerDate}
              canWrite={canWrite}
              onSelectDate={onSelectDate}
              onSelectEvent={onSelectEvent}
              t={t}
            />
          );
        })}
      </div>
    </div>
  );
}
