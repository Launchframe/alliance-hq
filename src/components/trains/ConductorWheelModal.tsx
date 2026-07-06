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
  qualification?: MemberQualificationPayload | null;
  dayLabel?: string | null;
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

export function ConductorWheelModal({
  open,
  candidates,
  winner,
  stats,
  qualification,
  dayLabel,
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
              return (
                <div
                  key={i}
                  className="flex items-center justify-center px-4 text-center font-bold text-hq-fg"
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
