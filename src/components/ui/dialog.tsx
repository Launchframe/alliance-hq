"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { dialogPanelClassName } from "@/components/ui/dialog-panel.shared";

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

/** Nested open dialogs share one body scroll lock. */
let bodyScrollLockCount = 0;
let previousBodyOverflow = "";

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  if (bodyScrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
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

  React.useEffect(() => {
    if (!open || presentationHidden) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [open, presentationHidden]);

  if (!open || !mounted) {
    return null;
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-end justify-center overscroll-none p-4 sm:items-center${
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
      <div className={`${dialogPanelClassName(className)} overscroll-contain`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
