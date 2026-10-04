"use client";

import { AlertTriangle } from "lucide-react";

type Props = {
  label: string;
  compact?: boolean;
};

export function TrainEligibilityOverrideMark({
  label,
  compact = false,
}: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center text-hq-warning ${
        compact ? "" : "rounded-full bg-hq-warning/15 p-0.5"
      }`}
      title={label}
      aria-label={label}
      data-testid="train-eligibility-override-mark"
    >
      <AlertTriangle
        className={compact ? "h-3 w-3" : "h-3.5 w-3.5"}
        strokeWidth={2.25}
        aria-hidden
      />
    </span>
  );
}
