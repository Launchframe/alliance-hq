"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { SerializedTimeOffEntry } from "@/lib/time-off/types.shared";
import {
  addCalendarMonths,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";
import { buildMonthGrid } from "@/lib/trains/trains-display-calendar.shared";

type Props = {
  entries: SerializedTimeOffEntry[];
  monthKey: string;
  todayServerDate: string;
  onMonthChange: (monthKey: string) => void;
  onSelectEntry?: (entry: SerializedTimeOffEntry) => void;
};

function entriesForDate(
  entries: SerializedTimeOffEntry[],
  date: string,
): SerializedTimeOffEntry[] {
  return entries.filter(
    (entry) => date >= entry.startDate && date <= entry.endDate,
  );
}

export function TimeOffCalendar({
  entries,
  monthKey,
  todayServerDate,
  onMonthChange,
  onSelectEntry,
}: Props) {
  const t = useTranslations("timeOff");
  const [weekdayHeaders] = useState(() =>
    t.raw("calendar.weekdayHeaders") as string[],
  );
  const grid = useMemo(() => buildMonthGrid(monthKey, 1), [monthKey]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded border border-hq-border p-2 hover:bg-hq-bg-muted"
          aria-label={t("calendar.previousMonth")}
          onClick={() => onMonthChange(addCalendarMonths(monthKey, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium text-hq-fg">{monthKey}</div>
        <button
          type="button"
          className="rounded border border-hq-border p-2 hover:bg-hq-bg-muted"
          aria-label={t("calendar.nextMonth")}
          onClick={() => onMonthChange(addCalendarMonths(monthKey, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-hq-fg-muted">
        {weekdayHeaders.map((label) => (
          <div key={label} className="py-1 font-medium">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell) => {
          const dayEntries = entriesForDate(entries, cell.date);
          const isToday = cell.date === todayServerDate;
          const weekday = getServerDayOfWeek(cell.date);
          return (
            <div
              key={cell.date}
              className={`min-h-24 rounded border p-1 text-left ${
                cell.inMonth
                  ? "border-hq-border bg-hq-bg"
                  : "border-transparent bg-transparent text-hq-fg-subtle"
              } ${isToday ? "ring-2 ring-hq-accent" : ""}`}
            >
              <div className="text-xs font-medium text-hq-fg">
                {cell.date.slice(-2)}
                <span className="sr-only">{weekdayHeaders[weekday]}</span>
              </div>
              <div className="mt-1 space-y-1">
                {dayEntries.slice(0, 3).map((entry) => (
                  <button
                    key={`${cell.date}-${entry.id}`}
                    type="button"
                    onClick={() => onSelectEntry?.(entry)}
                    className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium ${
                      entry.entryKind === "unexpected"
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : entry.entryKind === "officer_marked"
                          ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                          : "bg-sky-500/15 text-sky-800 dark:text-sky-200"
                    }`}
                  >
                    {entry.memberName}
                  </button>
                ))}
                {dayEntries.length > 3 ? (
                  <div className="text-[10px] text-hq-fg-muted">
                    {t("calendar.more", { count: dayEntries.length - 3 })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
