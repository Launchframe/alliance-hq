"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { BattlePlanCalendarViewToggle } from "@/components/battle-plan/BattlePlanCalendarViewToggle";
import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
import {
  buildDailyGrid,
  formatDailyRangeLabel,
  readStoredBattlePlanCalendarView,
  writeStoredBattlePlanCalendarView,
  type BattlePlanCalendarView,
} from "@/lib/battle-plan/calendar-view.shared";
import {
  formatLocalCaptureTime,
  groupEventsByServerDate,
} from "@/lib/battle-plan/display.shared";
import { capturePolicyBarClassName } from "@/lib/battle-plan/marker-colors.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";
import {
  addCalendarDays,
  addCalendarMonths,
  getMonthKey,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";
import { buildMonthGrid } from "@/lib/trains/trains-display-calendar.shared";

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
  dimmed,
  scheduledEvents,
  isToday,
  variant,
  canWrite,
  onSelectDate,
  onSelectEvent,
  t,
}: {
  date: string;
  weekdayLabel: string;
  dimmed: boolean;
  scheduledEvents: SerializedCaptureEvent[];
  isToday: boolean;
  variant: "daily" | "month";
  canWrite: boolean;
  onSelectDate?: (serverDate: string) => void;
  onSelectEvent?: (event: SerializedCaptureEvent) => void;
  t: ReturnType<typeof useTranslations<"battlePlan">>;
}) {
  const daySelectable = canWrite && onSelectDate != null && !dimmed;
  const eventLimit = variant === "daily" ? 8 : 3;
  const eventTextClass = variant === "daily" ? "text-xs" : "text-[10px]";
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
      className={`rounded border p-2 text-left ${
        variant === "daily" ? "min-h-40" : "min-h-24 p-1 text-xs"
      } ${
        dimmed
          ? "border-transparent bg-transparent text-hq-fg-subtle"
          : "border-hq-border bg-hq-bg"
      } ${isToday ? "ring-2 ring-hq-accent" : ""} ${
        daySelectable ? "cursor-pointer hover:border-hq-accent" : ""
      }`}
    >
      <div
        className={`font-medium text-hq-fg ${
          variant === "daily" ? "text-sm" : "text-xs"
        }`}
      >
        {variant === "daily" ? `${weekdayLabel} ${date.slice(-2)}` : date.slice(-2)}
      </div>
      {scheduledEvents.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {scheduledEvents.slice(0, eventLimit).map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                onSelectEvent?.(event);
              }}
              className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 font-medium ${eventTextClass} ${capturePolicyBarClassName(event.effectiveCapturePolicy)}`}
            >
              {event.iconPreset ? (
                <MarkerBadge iconPreset={event.iconPreset} size="sm" />
              ) : null}
              <span className={variant === "daily" ? "text-left" : "truncate"}>
                {formatLocalCaptureTime(event.scheduledAt)}
                {" · "}
                {variant === "daily"
                  ? territoryLabel(event)
                  : event.territoryType === "stronghold"
                    ? "SH"
                    : "C"}
              </span>
            </button>
          ))}
          {scheduledEvents.length > eventLimit ? (
            <div className="text-[10px] text-hq-fg-muted">
              {t("calendar.more", { count: scheduledEvents.length - eventLimit })}
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
  const [calendarView, setCalendarView] = useState<BattlePlanCalendarView>(() =>
    readStoredBattlePlanCalendarView(),
  );
  const [anchorDate, setAnchorDate] = useState(todayServerDate);
  const [monthKey, setMonthKey] = useState(getMonthKey(todayServerDate));
  const grouped = useMemo(() => groupEventsByServerDate(events), [events]);
  const dailyGrid = useMemo(() => buildDailyGrid(anchorDate), [anchorDate]);
  const monthGrid = useMemo(() => buildMonthGrid(monthKey), [monthKey]);

  const handleViewChange = useCallback(
    (view: BattlePlanCalendarView) => {
      setCalendarView(view);
      writeStoredBattlePlanCalendarView(view);
      if (view === "day") {
        setAnchorDate(todayServerDate);
        return;
      }
      setMonthKey(getMonthKey(anchorDate));
    },
    [anchorDate, todayServerDate],
  );

  const headerLabel =
    calendarView === "day" ? formatDailyRangeLabel(anchorDate) : monthKey;

  const weekdayLabel = (date: string) => weekdayHeaders[getServerDayOfWeek(date)];

  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-hq-border p-1 text-hq-fg-muted hover:text-hq-fg"
            onClick={() =>
              calendarView === "day"
                ? setAnchorDate((current) => addCalendarDays(current, -1))
                : setMonthKey((current) => addCalendarMonths(current, -1))
            }
            aria-label={
              calendarView === "day"
                ? t("calendar.previousDay")
                : t("calendar.previousMonth")
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-40 text-center text-sm font-semibold text-hq-fg">
            {headerLabel}
          </h2>
          <button
            type="button"
            className="rounded border border-hq-border p-1 text-hq-fg-muted hover:text-hq-fg"
            onClick={() =>
              calendarView === "day"
                ? setAnchorDate((current) => addCalendarDays(current, 1))
                : setMonthKey((current) => addCalendarMonths(current, 1))
            }
            aria-label={
              calendarView === "day"
                ? t("calendar.nextDay")
                : t("calendar.nextMonth")
            }
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <BattlePlanCalendarViewToggle
          view={calendarView}
          dayLabel={t("calendar.viewDay")}
          monthLabel={t("calendar.viewMonth")}
          onChange={handleViewChange}
        />
      </div>

      {calendarView === "month" ? (
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-hq-fg-muted">
          {weekdayHeaders.map((label) => (
            <div key={label} className="py-1 font-medium">
              {label}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={`grid gap-2 ${
          calendarView === "day" ? "mt-1 grid-cols-3" : "mt-1 grid-cols-7 gap-1"
        }`}
      >
        {(calendarView === "day" ? dailyGrid : monthGrid).map((cell) => {
          const dayEvents = grouped.get(cell.date) ?? [];
          const scheduledEvents = dayEvents.filter(
            (event) => event.status === "scheduled",
          );
          const isToday = cell.date === todayServerDate;
          const dimmed =
            calendarView === "month" &&
            "inMonth" in cell &&
            cell.inMonth === false;
          return (
            <DayCell
              key={cell.date}
              date={cell.date}
              weekdayLabel={weekdayLabel(cell.date)}
              dimmed={dimmed}
              scheduledEvents={scheduledEvents}
              isToday={isToday}
              variant={calendarView === "day" ? "daily" : "month"}
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
