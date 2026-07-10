"use client";

import type { BattlePlanTimeDisplay } from "@/lib/battle-plan/time-display.shared";

type Props = {
  value: BattlePlanTimeDisplay;
  localLabel: string;
  serverLabel: string;
  onChange: (value: BattlePlanTimeDisplay) => void;
};

export function BattlePlanTimeDisplayToggle({
  value,
  localLabel,
  serverLabel,
  onChange,
}: Props) {
  return (
    <div
      className="inline-flex rounded-lg border border-hq-border bg-hq-canvas p-0.5"
      role="tablist"
      aria-label="Time display"
      data-testid="battle-plan-time-display-toggle"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "local"}
        onClick={() => onChange("local")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          value === "local"
            ? "bg-hq-surface text-hq-fg"
            : "text-hq-fg-muted hover:text-hq-fg"
        }`}
      >
        {localLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "server"}
        onClick={() => onChange("server")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          value === "server"
            ? "bg-hq-surface text-hq-fg"
            : "text-hq-fg-muted hover:text-hq-fg"
        }`}
      >
        {serverLabel}
      </button>
    </div>
  );
}
