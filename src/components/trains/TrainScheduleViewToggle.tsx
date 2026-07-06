"use client";

type ScheduleView = "week" | "month";

type Props = {
  view: ScheduleView;
  weekLabel: string;
  monthLabel: string;
  onChange: (view: ScheduleView) => void;
};

export function TrainScheduleViewToggle({
  view,
  weekLabel,
  monthLabel,
  onChange,
}: Props) {
  return (
    <div
      className="inline-flex rounded-lg border border-hq-border bg-hq-canvas p-0.5"
      role="tablist"
      aria-label="Schedule view"
      data-testid="trains-schedule-view-toggle"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "week"}
        onClick={() => onChange("week")}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          view === "week"
            ? "bg-hq-surface text-hq-fg"
            : "text-hq-fg-muted hover:text-hq-fg"
        }`}
      >
        {weekLabel}
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

export type { ScheduleView };
