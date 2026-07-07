"use client";

import * as React from "react";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Label/value row for mobile record cards — accent label, larger value. */
export function RecordDetailField({
  label,
  children,
  className,
  valueClassName,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("rounded-lg bg-hq-canvas px-3 py-2.5", className)}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-hq-accent">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 min-w-0 text-base font-medium leading-snug text-hq-fg",
          valueClassName,
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function RecordDetailCard({
  children,
  className,
  selected = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);

  return (
    <article
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "space-y-2 rounded-xl border border-hq-border bg-hq-surface p-3",
        interactive &&
          "cursor-pointer transition-colors hover:border-[#484f58] hover:bg-hq-surface-muted/40",
        selected &&
          "border-hq-accent/60 bg-hq-selected/25 ring-1 ring-inset ring-hq-accent/30",
        className,
      )}
    >
      {children}
    </article>
  );
}

/**
 * Mobile: stacked record cards. md+: full data table (no horizontal scroll on narrow viewports).
 */
export function ResponsiveRecordViews({
  emptyMessage,
  isEmpty,
  mobileCards,
  desktopTable,
  className,
}: {
  emptyMessage?: string;
  isEmpty?: boolean;
  mobileCards: React.ReactNode;
  desktopTable: React.ReactNode;
  className?: string;
}) {
  if (isEmpty && emptyMessage) {
    return (
      <p
        className={cn(
          "rounded-xl border border-hq-border px-4 py-6 text-sm text-hq-fg-muted",
          className,
        )}
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="grid grid-cols-1 gap-3 md:hidden">{mobileCards}</div>
      <div className="hidden md:block">{desktopTable}</div>
    </div>
  );
}
