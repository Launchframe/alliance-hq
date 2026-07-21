"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useTranslations } from "next-intl";

import {
  buildConductorWheelReelSession,
  type ReelSession,
} from "@/lib/trains/conductor-wheel-reel.shared";
import type { MemberQualificationPayload } from "@/lib/trains/train-conductor-minimums.shared";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

export type WheelCandidate = {
  memberId: string;
  memberName: string;
  priorDayVsScore?: number;
};

type Props = {
  open: boolean;
  candidates: WheelCandidate[];
  winner: WheelCandidate | null;
  stats: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  } | null;
  qualification?: MemberQualificationPayload | null;
  dayLabel?: string | null;
  /** The selection mechanism used for this roll (e.g. "vs_top_10", "vs_high_score"). */
  mechanism?: string | null;
  speedMultiplier?: number;
  automated?: boolean;
  onAutomatedRevealComplete?: () => void;
  onClose: () => void;
  onSpinAgain?: () => void;
  onOverride?: (overrideReason: string) => void;
};

// Slot-machine geometry
const ITEM_H = 80;
const VISIBLE = 3;
const VIEWPORT_H = ITEM_H * VISIBLE;
const CENTER_OFFSET = Math.floor(VISIBLE / 2) * ITEM_H;

const FAST_SPEED = 30;
const FAST_SECS = 2.5;
const SLOW_SECS = 1.8;

type ReelSessionView = ReelSession;

function isVsMechanism(mechanism: string | null | undefined): boolean {
  return mechanism === "vs_top_10" || mechanism === "vs_high_score";
}

function vsScoreColor(score: number): string {
  if (score >= 5_000_000) return "text-amber-300";
  if (score >= 1_000_000) return "text-cyan-300";
  if (score >= 500_000) return "text-emerald-300";
  return "text-hq-fg-muted";
}

function formatVsScore(score: number): string {
  if (score >= 1_000_000) return `${(score / 1_000_000).toFixed(1)}M`;
  if (score >= 1_000) return `${(score / 1_000).toFixed(0)}K`;
  return String(score);
}

export function ConductorWheelModal({
  open,
  candidates,
  winner,
  stats,
  qualification,
  dayLabel,
  mechanism,
  speedMultiplier = 1,
  automated = false,
  onAutomatedRevealComplete,
  onClose,
  onSpinAgain,
  onOverride,
}: Props) {
  const t = useTranslations("trains.wheel");
  const reelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const fastSecs = FAST_SECS / speedMultiplier;
  const slowSecs = SLOW_SECS / speedMultiplier;

  const disqualified =
    qualification != null && qualification.qualified === false;

  const showVsValidation = isVsMechanism(mechanism);
  const winnerScore = winner
    ? (candidates.find((c) => c.memberId === winner.memberId)
        ?.priorDayVsScore ?? winner.priorDayVsScore)
    : undefined;

  const rankedCandidates = useMemo(() => {
    if (!showVsValidation) return [];
    return [...candidates]
      .filter((c) => c.priorDayVsScore != null && c.priorDayVsScore > 0)
      .sort((a, b) => (b.priorDayVsScore ?? 0) - (a.priorDayVsScore ?? 0));
  }, [candidates, showVsValidation]);

  const reelSession = useMemo((): ReelSessionView | null => {
    if (!open || !winner || candidates.length === 0) return null;
    return buildConductorWheelReelSession(candidates, winner, {
      visible: VISIBLE,
      fastSpeed: FAST_SPEED,
      fastSecs,
      slowSecs,
    });
  }, [open, winner, candidates, fastSecs, slowSecs]);

  const phase =
    reelSession && revealedKey === reelSession.key ? "revealed" : "spinning";

  const fireConfetti = useCallback(() => {
    void confetti({
      particleCount: 140,
      spread: 90,
      origin: { y: 0.5 },
      colors: [
        "#ff0000",
        "#ffa500",
        "#ffff00",
        "#00ff00",
        "#0000ff",
        "#4b0082",
        "#ee82ee",
      ],
    });
  }, []);

  useEffect(() => {
    if (!open || !reelSession) return;
    const reel = reelRef.current;
    if (!reel) return;

    const { fastEndY, targetY, key } = reelSession;
    const totalMs = (fastSecs + slowSecs) * 1000;
    const fastFraction = fastSecs / (fastSecs + slowSecs);

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    reel.style.transform = "translateY(0px)";
    reel.style.filter = "";
    setRevealedKey(null);
    setOverrideReason("");

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
        const tFrac = progress / fastFraction;
        translateY = tFrac * fastEndY;
        blurPx = 8 + Math.sin(tFrac * Math.PI * 0.7) * 8;
      } else {
        const tFrac = (progress - fastFraction) / (1 - fastFraction);
        const eased = 1 - Math.pow(1 - tFrac, 4);
        translateY = fastEndY + eased * (targetY - fastEndY);
        blurPx = (1 - tFrac) * 8;
      }

      reel.style.transform = `translateY(${-translateY.toFixed(2)}px)`;
      reel.style.filter = blurPx > 0.4 ? `blur(${blurPx.toFixed(1)}px)` : "";

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        reel.style.transform = `translateY(${-targetY}px)`;
        reel.style.filter = "";
        setRevealedKey(key);
        if (!disqualified) {
          fireConfetti();
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [reelSession, open, fireConfetti, disqualified, fastSecs, slowSecs]);

  useEffect(() => {
    if (!automated || !open || phase !== "revealed" || disqualified) return;
    const timer = window.setTimeout(() => {
      onAutomatedRevealComplete?.();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    automated,
    open,
    phase,
    disqualified,
    onAutomatedRevealComplete,
  ]);

  useEffect(() => {
    if (!open || phase !== "revealed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, phase, onClose]);

  if (!open || !winner || !reelSession) return null;

  const { items: reelItems, winnerIdx } = reelSession;

  const periodLabel =
    qualification &&
    (qualification.periodStart === qualification.periodEnd
      ? qualification.periodStart
      : `${qualification.periodStart} – ${qualification.periodEnd}`);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conductor-wheel-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-hq-border bg-hq-surface p-6 shadow-2xl">
        <h2
          id="conductor-wheel-title"
          className="text-center text-sm uppercase tracking-wide text-hq-fg-muted"
        >
          {disqualified && phase === "revealed" ? t("disqualifiedTitle") : t("title")}
        </h2>
        {dayLabel ? (
          <p className="mt-1 text-center text-base font-semibold text-hq-fg">
            {dayLabel}
          </p>
        ) : null}

        <div
          className="relative mt-6 overflow-hidden rounded-xl"
          style={{ height: VIEWPORT_H }}
        >
          <div ref={reelRef} style={{ willChange: "transform, filter" }}>
            {reelItems.map((name, i) => {
              const isCenter = phase === "revealed" && i === winnerIdx;
              const centerDisqualified = isCenter && disqualified;
              const showScore =
                isCenter &&
                !centerDisqualified &&
                winnerScore != null &&
                winnerScore > 0;
              return (
                <div
                  key={i}
                  className="flex flex-col items-center justify-center px-4 text-center font-bold text-hq-fg"
                  style={{ height: ITEM_H }}
                >
                  <span
                    className={
                      centerDisqualified
                        ? "text-4xl text-hq-danger transition-colors duration-500"
                        : isCenter
                          ? "text-4xl text-white"
                          : "text-2xl opacity-75"
                    }
                  >
                    {name}
                  </span>
                  {showScore ? (
                    <span
                      className={`mt-0.5 text-sm font-semibold ${vsScoreColor(winnerScore!)}`}
                    >
                      {formatVsScore(winnerScore!)} VR
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div
            className={`pointer-events-none absolute inset-x-0 rounded-lg border ring-1 ${
              disqualified && phase === "revealed"
                ? "border-hq-danger/60 bg-hq-danger/10 ring-hq-danger/20"
                : "border-[#388bfd]/60 bg-[#388bfd]/10 ring-[#388bfd]/20"
            }`}
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

        {phase === "revealed" &&
          !disqualified &&
          showVsValidation &&
          rankedCandidates.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
              {mechanism === "vs_high_score"
                ? t("vsValidation.top1Title")
                : t("vsValidation.top10Title")}
            </p>
            <div className="overflow-hidden rounded-lg border border-hq-border">
              <ul className="divide-y divide-hq-border/60">
                {rankedCandidates.map((candidate, idx) => {
                  const isWinner =
                    winner && candidate.memberId === winner.memberId;
                  return (
                    <li
                      key={candidate.memberId}
                      className={`flex items-center justify-between gap-3 px-3 py-2 ${
                        isWinner ? "bg-[#388bfd]/10" : "bg-hq-surface/60"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-xs font-semibold text-hq-fg-muted">
                          #{idx + 1}
                        </span>
                        <span
                          className={`truncate text-sm font-medium ${
                            isWinner ? "text-white" : "text-hq-fg"
                          }`}
                        >
                          {candidate.memberName}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-semibold ${vsScoreColor(candidate.priorDayVsScore!)}`}
                      >
                        {formatVsScore(candidate.priorDayVsScore!)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}

        {phase === "revealed" && disqualified && qualification ? (
          <div className="mt-4 space-y-2 text-center text-sm text-hq-fg">
            <p className="text-hq-danger">{t("disqualifiedBody")}</p>
            <p className="text-xs text-hq-fg-muted">
              {t("evaluationPeriod", { period: periodLabel ?? "" })}
            </p>
            {qualification.vs.minimum > 0 ? (
              <p className="text-xs">
                {t("vsShortfall", {
                  score: qualification.vs.score,
                  required: qualification.vs.effectiveMinimum,
                  shortfall: qualification.vs.shortfall,
                })}
              </p>
            ) : null}
            {qualification.donation.minimum > 0 ? (
              <p className="text-xs">
                {t("donationShortfall", {
                  score: qualification.donation.score,
                  required: qualification.donation.effectiveMinimum,
                  shortfall: qualification.donation.shortfall,
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {phase === "revealed" && !disqualified && stats ? (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <span className="rounded-full bg-hq-canvas px-3 py-1 text-xs text-hq-fg-muted ring-1 ring-hq-border">
              {t("lastConducted", {
                date: stats.lastConductedDate ?? t("never"),
              })}
            </span>
            <span className="rounded-full bg-hq-canvas px-3 py-1 text-xs text-hq-fg-muted ring-1 ring-hq-border">
              {t("conductsThisYear", { count: stats.conductsThisYear })}
            </span>
          </div>
        ) : null}

        {phase === "revealed" && disqualified && !automated ? (
          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              onOverride?.(overrideReason.trim());
            }}
          >
            <label className="block text-xs text-hq-fg-muted">
              {t("overrideReasonLabel")}
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                placeholder={t("overrideReasonPlaceholder")}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              />
            </label>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={onClose}
                data-testid="trains-wheel-cancel"
                className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => onSpinAgain?.()}
                className="rounded-lg bg-hq-surface-muted px-4 py-2 text-sm font-medium text-hq-fg ring-1 ring-hq-border hover:bg-hq-border"
              >
                {t("spinAgain")}
              </button>
              <button
                type="submit"
                className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
              >
                {t("override")}
              </button>
            </div>
          </form>
        ) : null}

        {phase === "revealed" && !disqualified && !automated ? (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
            >
              {t("close")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
