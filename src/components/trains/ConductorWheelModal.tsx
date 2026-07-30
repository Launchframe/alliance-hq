"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useLocale, useTranslations } from "next-intl";

import {
  ConductorWheelSharePreviewDialog,
  type ConductorWheelSharePreview,
} from "@/components/trains/ConductorWheelSharePreviewDialog";
import {
  buildConductorWheelReelSession,
  restingShareViewport,
  type ReelSession,
} from "@/lib/trains/conductor-wheel-reel.shared";
import { renderConductorWheelSharePngBlob } from "@/lib/client/conductor-wheel-share-image.client";
import {
  formatWheelShareEligibilityLine,
  resolveWheelShareEligibility,
} from "@/lib/trains/conductor-wheel-share.shared";
import {
  formatTrainPointCount,
  type MemberQualificationPayload,
} from "@/lib/trains/train-conductor-minimums.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

export type WheelCandidate = {
  memberId: string;
  memberName: string;
  priorDayVsScore?: number;
  allianceRank?: number | null;
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
  paintTemplate?: WeekTemplateType | null;
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

function scoreBoardKind(
  mechanism: string | null | undefined,
): "vs" | "vr" | null {
  if (
    mechanism === "vs_top_10" ||
    mechanism === "vs_high_score" ||
    mechanism === "vs_top_n"
  ) {
    return "vs";
  }
  if (mechanism === "vr_top_n") return "vr";
  return null;
}

function vsScoreColor(score: number): string {
  if (score >= 5_000_000) return "text-amber-600 dark:text-amber-300";
  if (score >= 1_000_000) return "text-cyan-700 dark:text-cyan-300";
  if (score >= 500_000) return "text-emerald-700 dark:text-emerald-300";
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
  paintTemplate,
  speedMultiplier = 1,
  automated = false,
  onAutomatedRevealComplete,
  onClose,
  onSpinAgain,
  onOverride,
}: Props) {
  const t = useTranslations("trains.wheel");
  const locale = useLocale();
  const reelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharePreview, setSharePreview] =
    useState<ConductorWheelSharePreview | null>(null);

  const fastSecs = FAST_SECS / speedMultiplier;
  const slowSecs = SLOW_SECS / speedMultiplier;

  const disqualified =
    qualification != null && qualification.qualified === false;

  const boardKind = scoreBoardKind(mechanism);
  const showScoreValidation = boardKind != null;
  const scoreSuffix = boardKind === "vr" ? "VR" : "VS";
  const winnerScore = winner
    ? (candidates.find((c) => c.memberId === winner.memberId)
        ?.priorDayVsScore ?? winner.priorDayVsScore)
    : undefined;

  const rankedCandidates = useMemo(() => {
    if (!showScoreValidation) return [];
    return [...candidates]
      .filter((c) => c.priorDayVsScore != null && c.priorDayVsScore > 0)
      .sort((a, b) => (b.priorDayVsScore ?? 0) - (a.priorDayVsScore ?? 0));
  }, [candidates, showScoreValidation]);

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

  const shareViewport = useMemo(() => {
    if (!reelSession) return null;
    return restingShareViewport(reelSession);
  }, [reelSession]);

  const shareEligibilityLine = useMemo(() => {
    if (!winner) return null;
    const leaderboardRank =
      showScoreValidation && rankedCandidates.length > 0
        ? rankedCandidates.findIndex(
            (candidate) => candidate.memberId === winner.memberId,
          ) + 1 || null
        : null;
    return formatWheelShareEligibilityLine(
      resolveWheelShareEligibility({
        mechanism,
        paintTemplate,
        winner,
        qualification,
        leaderboardRank:
          leaderboardRank && leaderboardRank > 0 ? leaderboardRank : null,
      }),
      {
        vsMinimum: (score, minimum) =>
          t("share.eligibilityVsMinimum", { score, minimum }),
        tpif: (score, sweetSpot) =>
          t("share.eligibilityTpif", { score, sweetSpot }),
        vsLeaderboardRank: (rank, score, suffix) =>
          t("share.eligibilityVsLeaderboardRank", { rank, score, suffix }),
        vsLeaderboardScore: (score, suffix) =>
          t("share.eligibilityVsLeaderboardScore", { score, suffix }),
      },
      locale,
    );
  }, [
    winner,
    mechanism,
    paintTemplate,
    qualification,
    showScoreValidation,
    rankedCandidates,
    locale,
    t,
  ]);

  const closeSharePreview = useCallback(() => {
    setSharePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const handleClose = useCallback(() => {
    closeSharePreview();
    onClose();
  }, [closeSharePreview, onClose]);

  const handleShareImage = useCallback(async () => {
    if (!winner || !shareViewport) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const statsLine =
        stats != null
          ? t("share.statsLine", {
              lastDate: stats.lastConductedDate ?? t("never"),
              count: stats.conductsThisYear,
            })
          : null;
      const blob = await renderConductorWheelSharePngBlob({
        title: t("title"),
        dayLabel,
        names: shareViewport.names,
        winnerIndex: shareViewport.winnerIndex,
        eligibilityLine: shareEligibilityLine,
        statsLine,
      });
      const safeDate =
        dayLabel?.replace(/[^\w-]+/g, "-").toLowerCase() ?? "conductor";
      const filename = `conductor-wheel-${safeDate}.png`;
      const url = URL.createObjectURL(blob);
      setSharePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url, filename };
      });
    } catch {
      setShareError(t("share.failed"));
    } finally {
      setShareBusy(false);
    }
  }, [
    winner,
    shareViewport,
    stats,
    dayLabel,
    shareEligibilityLine,
    t,
  ]);

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
    setShareError(null);
    closeSharePreview();

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
  }, [
    reelSession,
    open,
    fireConfetti,
    disqualified,
    fastSecs,
    slowSecs,
    closeSharePreview,
  ]);

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
      if (sharePreview) {
        closeSharePreview();
        return;
      }
      handleClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, phase, handleClose, sharePreview, closeSharePreview]);

  // Revoke blob URLs if the modal unmounts while a preview is open.
  const sharePreviewRef = useRef(sharePreview);
  useEffect(() => {
    sharePreviewRef.current = sharePreview;
  }, [sharePreview]);
  useEffect(() => {
    return () => {
      const prev = sharePreviewRef.current;
      if (prev) URL.revokeObjectURL(prev.url);
    };
  }, []);

  if (!open || !winner || !reelSession) return null;

  const { items: reelItems, winnerIdx } = reelSession;

  const periodLabel =
    qualification &&
    (qualification.periodStart === qualification.periodEnd
      ? qualification.periodStart
      : `${qualification.periodStart} – ${qualification.periodEnd}`);

  return (
    <>
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
                          ? "text-4xl text-hq-accent dark:text-white"
                          : "text-2xl text-hq-fg-muted opacity-90"
                    }
                  >
                    {name}
                  </span>
                  {showScore ? (
                    <span
                      className={`mt-0.5 text-sm font-semibold ${vsScoreColor(winnerScore!)}`}
                    >
                      {formatVsScore(winnerScore!)} {scoreSuffix}
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
                "linear-gradient(to bottom, var(--hq-surface) 0%, transparent 32%, transparent 68%, var(--hq-surface) 100%)",
            }}
          />
        </div>

        {phase === "revealed" &&
          !disqualified &&
          showScoreValidation &&
          rankedCandidates.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
              {boardKind === "vr"
                ? t("vsValidation.topNVrTitle", {
                    count: rankedCandidates.length,
                  })
                : rankedCandidates.length === 1
                  ? t("vsValidation.top1Title")
                  : t("vsValidation.topNVsTitle", {
                      count: rankedCandidates.length,
                    })}
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
                            isWinner
                              ? "text-hq-accent dark:text-white"
                              : "text-hq-fg"
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
                  score: formatTrainPointCount(qualification.vs.score, locale),
                  required: formatTrainPointCount(
                    qualification.vs.effectiveMinimum,
                    locale,
                  ),
                  shortfall: formatTrainPointCount(
                    qualification.vs.shortfall,
                    locale,
                  ),
                })}
              </p>
            ) : null}
            {qualification.donation.minimum > 0 ? (
              <p className="text-xs">
                {t("donationShortfall", {
                  score: formatTrainPointCount(
                    qualification.donation.score,
                    locale,
                  ),
                  required: formatTrainPointCount(
                    qualification.donation.effectiveMinimum,
                    locale,
                  ),
                  shortfall: formatTrainPointCount(
                    qualification.donation.shortfall,
                    locale,
                  ),
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
                onClick={handleClose}
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
          <div className="mt-6 flex flex-col items-center gap-3">
            {shareError ? (
              <p className="text-sm text-hq-danger" role="alert">
                {shareError}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                disabled={shareBusy}
                data-testid="trains-wheel-share"
                onClick={() => void handleShareImage()}
                className="rounded-lg border border-[#8957e5]/50 bg-[#8957e5]/10 px-4 py-2 text-sm font-medium text-[#8250df] hover:bg-[#8957e5]/20 disabled:opacity-50 dark:text-[#d2a8ff]"
              >
                {shareBusy ? t("share.exporting") : t("share.action")}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
              >
                {t("close")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>

    <ConductorWheelSharePreviewDialog
      open={sharePreview != null}
      preview={sharePreview}
      onClose={closeSharePreview}
    />
    </>
  );
}
