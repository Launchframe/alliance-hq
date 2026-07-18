"use client";

/** Waiting-page progress bar for an in-flight video job. Presentational only — see video-job-stage.shared.ts for the percent/indeterminate logic. */
export function VideoJobProgressBar({
  percent,
  indeterminate,
  label,
}: {
  percent: number;
  indeterminate: boolean;
  label: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-hq-surface-muted"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full bg-hq-accent transition-[width] duration-500 ${
          indeterminate ? "animate-pulse" : ""
        }`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
