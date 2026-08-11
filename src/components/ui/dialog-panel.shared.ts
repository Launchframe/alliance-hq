/** Panel class names for {@link Dialog}; omit defaults when callers override max-w/max-h/overflow. */
export function dialogPanelClassName(className: string): string {
  const hasMaxWidth = /\bmax-w-/.test(className);
  const hasMaxHeight = /\bmax-h-/.test(className);
  const hasOverflow = /\boverflow-/.test(className);
  return [
    "relative z-[101] w-full min-h-0 rounded-xl border border-hq-border bg-hq-surface p-5 shadow-xl",
    hasOverflow ? null : "overflow-y-auto",
    hasMaxWidth ? null : "max-w-lg",
    hasMaxHeight ? null : "max-h-[min(90vh,720px)]",
    className.trim() || null,
  ]
    .filter(Boolean)
    .join(" ");
}
