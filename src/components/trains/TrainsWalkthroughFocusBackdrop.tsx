"use client";

import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";

import {
  measureFocusRect,
  type FocusRect,
} from "@/lib/trains/walkthrough-helpers";

type Props = {
  targetCandidates: string[];
  showTapHint?: boolean;
  visible: boolean;
};

function FocusPanels({ rect }: { rect: FocusRect }) {
  const { top, left, width, height } = rect;
  const bottom = top + height;
  const right = left + width;
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;

  const panelClass =
    "fixed z-[45] bg-black/70 pointer-events-auto transition-opacity duration-200";

  return (
    <>
      {top > 0 ? (
        <div
          className={panelClass}
          style={{ top: 0, left: 0, right: 0, height: top }}
          aria-hidden
        />
      ) : null}
      {left > 0 ? (
        <div
          className={panelClass}
          style={{ top, left: 0, width: left, height }}
          aria-hidden
        />
      ) : null}
      {right < vw ? (
        <div
          className={panelClass}
          style={{ top, left: right, right: 0, height }}
          aria-hidden
        />
      ) : null}
      {bottom < vh ? (
        <div
          className={panelClass}
          style={{ top: bottom, left: 0, right: 0, bottom: 0 }}
          aria-hidden
        />
      ) : null}
    </>
  );
}

export function TrainsWalkthroughFocusBackdrop({
  targetCandidates,
  showTapHint = false,
  visible,
}: Props) {
  const [rect, setRect] = useState<FocusRect | null>(null);

  useEffect(() => {
    if (!visible) return;

    const measure = () => {
      setRect(measureFocusRect(targetCandidates));
    };

    const frame = requestAnimationFrame(measure);
    const timer = setTimeout(measure, 400);
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [targetCandidates, visible]);

  if (!visible || !rect) return null;

  return (
    <>
      <FocusPanels rect={rect} />
      {showTapHint ? (
        <div
          className="pointer-events-none fixed z-[46] animate-bounce text-white drop-shadow-lg"
          style={{
            top: rect.top + rect.height / 2 - 12,
            left: rect.left + rect.width / 2 - 12,
          }}
          aria-hidden
        >
          <MousePointerClick className="h-6 w-6" strokeWidth={2.25} />
        </div>
      ) : null}
    </>
  );
}
