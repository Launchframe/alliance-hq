"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export function ConductorWheelModal({
  open,
  candidates,
  winner,
  stats,
  onClose,
}: Props) {
  const t = useTranslations("trains.wheel");
  const [displayIndex, setDisplayIndex] = useState(0);
  const [phase, setPhase] = useState<"spinning" | "revealed">("spinning");
  const rafRef = useRef<number | null>(null);

  const fireConfetti = useCallback(() => {
    void confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.55 },
      colors: ["#ff0000", "#ffa500", "#ffff00", "#00ff00", "#0000ff", "#4b0082", "#ee82ee"],
    });
  }, []);

  useEffect(() => {
    if (!open || !winner || candidates.length === 0) return;

    let cancelled = false;
    const start = performance.now();
    const duration = 3200;

    const begin = requestAnimationFrame(() => {
      if (cancelled) return;
      setPhase("spinning");
      setDisplayIndex(0);

      const tick = (now: number) => {
        if (cancelled) return;
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - (1 - progress) ** 3;
        const interval = 40 + ease * 220;
        const idx = Math.floor(elapsed / interval) % candidates.length;
        setDisplayIndex(idx);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          const winnerIdx = candidates.findIndex(
            (c) => c.memberId === winner.memberId,
          );
          setDisplayIndex(winnerIdx >= 0 ? winnerIdx : 0);
          setPhase("revealed");
          fireConfetti();
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(begin);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, winner, candidates, fireConfetti]);

  if (!open || !winner) return null;

  const shown =
    phase === "revealed"
      ? winner.memberName
      : (candidates[displayIndex]?.memberName ?? winner.memberName);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conductor-wheel-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[#30363d] bg-[#161b22] p-6 shadow-2xl">
        <h2 id="conductor-wheel-title" className="text-center text-sm uppercase tracking-wide text-[#8b949e]">
          {t("title")}
        </h2>
        <p
          className={`mt-6 text-center font-bold text-[#e6edf3] transition-all ${
            phase === "revealed"
              ? "scale-100 text-5xl opacity-100"
              : "scale-95 text-3xl opacity-90 blur-[0.5px]"
          }`}
        >
          {shown}
        </p>
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
