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
      <div
        className={`relative z-[101] max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-[#30363d] bg-[#161b22] p-5 shadow-xl ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
