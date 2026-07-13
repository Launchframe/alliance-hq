"use client";

import * as React from "react";
import { createPortal } from "react-dom";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
  ignoreOutsideDismiss?: boolean;
  /** Keep children mounted but hide the dialog chrome (e.g. bug-report screenshot mode). */
  presentationHidden?: boolean;
};

function dialogPanelClassName(className: string): string {
  // Callers often pass max-w-* / max-h-*; those must replace defaults. Without
  // twMerge, later HTML classes do not win — omit defaults when overridden.
  const hasMaxWidth = /\bmax-w-/.test(className);
  const hasMaxHeight = /\bmax-h-/.test(className);
  return [
    "relative z-[101] w-full overflow-y-auto rounded-xl border border-hq-border bg-hq-surface p-5 shadow-xl",
    hasMaxWidth ? null : "max-w-lg",
    hasMaxHeight ? null : "max-h-[min(90vh,720px)]",
    className.trim() || null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Dialog({
  open,
  onOpenChange,
  children,
  title,
  className = "",
  ignoreOutsideDismiss = false,
  presentationHidden = false,
}: DialogProps) {
  const [mounted] = React.useState(() => typeof document !== "undefined");

  React.useEffect(() => {
    if (!open || presentationHidden) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !ignoreOutsideDismiss) {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [ignoreOutsideDismiss, onOpenChange, open, presentationHidden]);

  if (!open || !mounted) {
    return null;
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center${
        presentationHidden ? " invisible pointer-events-none" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close dialog"
        onClick={() => {
          if (!ignoreOutsideDismiss) onOpenChange(false);
        }}
      />
      <div className={dialogPanelClassName(className)}>{children}</div>
    </div>,
    document.body,
  );
}
