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
    <div className={cn("rounded-lg bg-[#0d1117] px-3 py-2.5", className)}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#58a6ff]">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 min-w-0 text-base font-medium leading-snug text-[#e6edf3]",
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
        "space-y-2 rounded-xl border border-[#30363d] bg-[#161b22] p-3",
        interactive &&
          "cursor-pointer transition-colors hover:border-[#484f58] hover:bg-[#21262d]/40",
        selected &&
          "border-[#58a6ff]/60 bg-[#1f3d5c]/25 ring-1 ring-inset ring-[#58a6ff]/30",
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
          "rounded-xl border border-[#30363d] px-4 py-6 text-sm text-[#8b949e]",
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
