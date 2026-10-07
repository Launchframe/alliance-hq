"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type Props = {
  /** Accessible name for the trigger — usually the setting's visible label. */
  label: string;
  children: React.ReactNode;
};

/** Hover/focus on desktop, tap on touch; Escape or an outside tap closes it. */
export function InfoTooltip({ label, children }: Props) {
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setPinned(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPinned(false);
        setHovered(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinned]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={() => setPinned((value) => !value)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-hq-fg-muted hover:text-hq-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-1 w-64 max-w-[min(16rem,80vw)] rounded-lg border border-hq-border bg-hq-surface p-3 text-xs leading-relaxed text-hq-fg shadow-lg"
      >
        {children}
      </span>
    </span>
  );
}
