"use client";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type ReviewSegmentedOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T | null;
  options: ReviewSegmentedOption<T>[];
  onChange: (next: T | null) => void;
  ariaLabel: string;
  /** When true, clicking the active option clears the selection. */
  allowDeselect?: boolean;
  size?: "sm" | "md";
  className?: string;
};

export function ReviewSegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  allowDeselect = false,
  size = "md",
  className,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-hq-border bg-hq-canvas p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active && allowDeselect) {
                onChange(null);
                return;
              }
              onChange(option.value);
            }}
            className={cn(
              "rounded-md font-medium transition-colors",
              size === "sm"
                ? "px-2.5 py-1 text-xs"
                : "flex-1 px-3 py-2 text-sm",
              active
                ? "bg-hq-border text-hq-fg shadow-sm"
                : "text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
