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
      className="inline-flex rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5"
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
            ? "bg-[#161b22] text-[#e6edf3]"
            : "text-[#8b949e] hover:text-[#e6edf3]"
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
            ? "bg-[#161b22] text-[#e6edf3]"
            : "text-[#8b949e] hover:text-[#e6edf3]"
        }`}
      >
        {monthLabel}
      </button>
    </div>
  );
}

export type { ScheduleView };
