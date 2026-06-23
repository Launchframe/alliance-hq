"use client";

import { useEffect, useRef } from "react";

import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";

type Props = {
  allianceName: string;
  allianceTag: string;
  welcomePrefix: string;
};

export function AllianceWelcomeHero({
  allianceName,
  allianceTag,
  welcomePrefix,
}: Props) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      fireCelebrationConfetti();
    }
  }, []);

  return (
    <div className="space-y-6 text-center">
      <div className="space-y-1">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#58a6ff]">
          {welcomePrefix}
        </p>
        <h1 className="text-2xl font-bold text-[#e6edf3] sm:text-3xl">
          {allianceName}
        </h1>
      </div>

      <div className="relative mx-auto max-w-md px-2 py-2">
        <div
          aria-hidden
          className="alliance-tag-glow pointer-events-none absolute -inset-3 rounded-2xl bg-gradient-to-r from-[#f778ba]/30 via-[#58a6ff]/40 to-[#3fb950]/30 blur-xl motion-reduce:hidden"
        />
        <div className="relative overflow-hidden rounded-xl border-2 border-[#484f58] bg-[#0d1117] px-6 py-5 shadow-[0_0_40px_rgba(88,166,255,0.25)]">
          <div
            aria-hidden
            className="alliance-tag-shimmer pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(255,255,255,0.12)_45%,transparent_90%)] motion-reduce:hidden"
          />
          <p className="alliance-tag-text relative font-mono text-4xl font-black uppercase tracking-[0.2em] sm:text-5xl">
            {allianceTag}
          </p>
        </div>
      </div>
    </div>
  );
}
