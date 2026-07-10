"use client";

import type { BattlePlanCalendarView } from "@/lib/battle-plan/calendar-view.shared";

type Props = {
  view: BattlePlanCalendarView;
  dayLabel: string;
  monthLabel: string;
  onChange: (view: BattlePlanCalendarView) => void;
  className?: string;
};

export function BattlePlanCalendarViewToggle({
  view,
  dayLabel,
  monthLabel,
  onChange,
  className = "inline-flex",
}: Props) {
  return (
    <div
      className={`rounded-lg border border-hq-border bg-hq-canvas p-0.5 ${className}`}
      role="tablist"
      aria-label="Calendar view"
      data-testid="battle-plan-calendar-view-toggle"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "day"}
        onClick={() => onChange("day")}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          view === "day"
            ? "bg-hq-surface text-hq-fg"
            : "text-hq-fg-muted hover:text-hq-fg"
        }`}
      >
        {dayLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "month"}
        onClick={() => onChange("month")}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          view === "month"
            ? "bg-hq-surface text-hq-fg"
            : "text-hq-fg-muted hover:text-hq-fg"
        }`}
      >
        {monthLabel}
      </button>
    </div>
  );
}
