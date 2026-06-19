"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useTranslations } from "next-intl";

type WheelCandidate = {
  memberId: string;
  memberName: string;
};

type Props = {
  open: boolean;
  candidates: WheelCandidate[];
  winner: WheelCandidate | null;
  stats: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  } | null;
  onClose: () => void;
};

// Slot-machine geometry
const ITEM_H = 80;
const VISIBLE = 3; // items showing through the slit (odd → clean center)
const VIEWPORT_H = ITEM_H * VISIBLE;
const CENTER_OFFSET = Math.floor(VISIBLE / 2) * ITEM_H; // px from top to center slot

// Animation targets (independent of candidate count)
const FAST_SPEED = 30; // items / second during the fast phase
const FAST_SECS = 2.5; // seconds of fast linear spinning
const SLOW_SECS = 1.8; // seconds of ease-out deceleration

type ReelSession = {
  items: string[];
  fastEndY: number;
  targetY: number;
  winnerIdx: number;
  key: string;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]] as [T, T];
  }
  return a;
}

function buildReelSession(
  candidates: WheelCandidate[],
  winner: WheelCandidate,
): ReelSession {
  const names = candidates.map((c) => c.memberName);

  const fastItemCount = Math.ceil(FAST_SPEED * FAST_SECS);
  const fastPasses = Math.ceil(fastItemCount / names.length);

  const decelItemCount = Math.ceil((FAST_SPEED * SLOW_SECS) / 2);
  const slowPasses = Math.max(3, Math.ceil(decelItemCount / names.length));

  const items: string[] = [];
  for (let i = 0; i < fastPasses; i++) items.push(...shuffle(names));
  for (let i = 0; i < slowPasses; i++) items.push(...shuffle(names));

  const winnerIdx = items.length;
  items.push(winner.memberName);

  for (let i = 0; i < Math.floor(VISIBLE / 2) + 1; i++) {
    items.push(names[i % names.length]!);
  }

  const fastEndY = fastPasses * names.length * ITEM_H;
  const targetY = winnerIdx * ITEM_H - CENTER_OFFSET;

  return {
    items,
    fastEndY,
    targetY,
    winnerIdx,
    key: `${winner.memberId}:${winnerIdx}:${items.length}`,
  };
}

export function ConductorWheelModal({
  open,
  candidates,
  winner,
  stats,
  onClose,
}: Props) {
  const t = useTranslations("trains.wheel");
  const reelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const reelSession = useMemo(() => {
    if (!open || !winner || candidates.length === 0) return null;
    return buildReelSession(candidates, winner);
  }, [open, winner, candidates]);

  const phase =
    reelSession && revealedKey === reelSession.key ? "revealed" : "spinning";

  const fireConfetti = useCallback(() => {
    void confetti({
      particleCount: 140,
      spread: 90,
      origin: { y: 0.5 },
      colors: ["#ff0000", "#ffa500", "#ffff00", "#00ff00", "#0000ff", "#4b0082", "#ee82ee"],
    });
  }, []);

  useEffect(() => {
    if (!open || !reelSession) return;
    const reel = reelRef.current;
    if (!reel) return;

    const { fastEndY, targetY, key } = reelSession;
    const totalMs = (FAST_SECS + SLOW_SECS) * 1000;
    const fastFraction = FAST_SECS / (FAST_SECS + SLOW_SECS);

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    reel.style.transform = "translateY(0px)";
    reel.style.filter = "";

    let startTime: number | null = null;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      if (startTime === null) startTime = now;

      const elapsed = now - startTime;
      const progress = Math.min(elapsed / totalMs, 1);

      let translateY: number;
      let blurPx: number;

      if (progress < fastFraction) {
        const t = progress / fastFraction;
        translateY = t * fastEndY;
        blurPx = 8 + Math.sin(t * Math.PI * 0.7) * 8;
      } else {
        const t = (progress - fastFraction) / (1 - fastFraction);
        const eased = 1 - Math.pow(1 - t, 4);
        translateY = fastEndY + eased * (targetY - fastEndY);
        blurPx = (1 - t) * 8;
      }

      reel.style.transform = `translateY(${-translateY.toFixed(2)}px)`;
      reel.style.filter = blurPx > 0.4 ? `blur(${blurPx.toFixed(1)}px)` : "";

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        reel.style.transform = `translateY(${-targetY}px)`;
        reel.style.filter = "";
        setRevealedKey(key);
        fireConfetti();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [reelSession, open, fireConfetti]);

  if (!open || !winner || !reelSession) return null;

  const { items: reelItems, winnerIdx } = reelSession;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conductor-wheel-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[#30363d] bg-[#161b22] p-6 shadow-2xl">
        <h2
          id="conductor-wheel-title"
          className="text-center text-sm uppercase tracking-wide text-[#8b949e]"
        >
          {t("title")}
        </h2>

        <div
          className="relative mt-6 overflow-hidden rounded-xl"
          style={{ height: VIEWPORT_H }}
        >
          <div ref={reelRef} style={{ willChange: "transform, filter" }}>
            {reelItems.map((name, i) => {
              const isCenter = phase === "revealed" && i === winnerIdx;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center px-4 text-center font-bold text-[#e6edf3]"
                  style={{ height: ITEM_H }}
                >
                  <span
                    className={
                      isCenter
                        ? "text-4xl text-white"
                        : "text-2xl opacity-75"
                    }
                  >
                    {name}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 rounded-lg border border-[#388bfd]/60 bg-[#388bfd]/10 ring-1 ring-[#388bfd]/20"
            style={{ top: CENTER_OFFSET, height: ITEM_H }}
          />

          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, #161b22 0%, transparent 32%, transparent 68%, #161b22 100%)",
            }}
          />
        </div>

        {phase === "revealed" && stats ? (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <span className="rounded-full bg-[#0d1117] px-3 py-1 text-xs text-[#8b949e] ring-1 ring-[#30363d]">
              {t("lastConducted", {
                date: stats.lastConductedDate ?? t("never"),
              })}
            </span>
            <span className="rounded-full bg-[#0d1117] px-3 py-1 text-xs text-[#8b949e] ring-1 ring-[#30363d]">
              {t("conductsThisYear", { count: stats.conductsThisYear })}
            </span>
          </div>
        ) : null}

        {phase === "revealed" ? (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
            >
              {t("close")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
