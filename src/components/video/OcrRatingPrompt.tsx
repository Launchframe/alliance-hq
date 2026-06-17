"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";

export type OcrJobRating = "thumbs_up" | "thumbs_down";

/** Preset reason buckets for negative OCR ratings. */
export const OCR_RATING_REASONS = [
  "member_match",
  "score_parse",
  "wrong_event",
  "frame_quality",
  "other",
] as const;

export type OcrRatingReason = (typeof OCR_RATING_REASONS)[number];

type Props = {
  onClose: () => void;
  onRate: (rating: OcrJobRating, reason?: OcrRatingReason) => Promise<boolean>;
};

const AUTO_CLOSE_MS = 5000;

export function OcrRatingPrompt({ onClose, onRate }: Props) {
  const t = useTranslations("videoReview");
  const [phase, setPhase] = useState<"pick" | "reason" | "thanks">("pick");

  useEffect(() => {
    if (phase !== "thanks") return;
    const timer = window.setTimeout(() => onClose(), AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onClose]);

  const handlePick = useCallback(
    async (rating: OcrJobRating) => {
      if (rating === "thumbs_down") {
        setPhase("reason");
        return;
      }
      // thumbs_up: go straight to thanks + confetti
      setPhase("thanks");
      fireCelebrationConfetti();
      const ok = await onRate(rating);
      if (!ok) {
        setPhase("pick");
      }
    },
    [onRate],
  );

  const handleReason = useCallback(
    async (reason: OcrRatingReason) => {
      setPhase("thanks");
      const ok = await onRate("thumbs_down", reason);
      if (!ok) {
        setPhase("reason");
      }
    },
    [onRate],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-[#30363d] bg-[#161b22] p-8 text-center">
        {phase === "pick" ? (
          <>
            <p className="mb-6 text-lg font-medium text-[#e6edf3]">
              {t("ratingPrompt")}
            </p>
            <div className="flex justify-center gap-6">
              <button
                type="button"
                onClick={() => void handlePick("thumbs_up")}
                className="flex flex-col items-center gap-2 rounded-xl border border-[#30363d] p-4 transition-colors hover:border-[#3fb950] hover:bg-[#3fb95010]"
                aria-label={t("ratingThumbsUp")}
              >
                <ThumbsUp className="size-8 text-[#e6edf3]" strokeWidth={2} />
                <span className="text-xs text-[#8b949e]">
                  {t("ratingThumbsUp")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handlePick("thumbs_down")}
                className="flex flex-col items-center gap-2 rounded-xl border border-[#30363d] p-4 transition-colors hover:border-[#f85149] hover:bg-[#f8514910]"
                aria-label={t("ratingThumbsDown")}
              >
                <ThumbsDown className="size-8 text-[#e6edf3]" strokeWidth={2} />
                <span className="text-xs text-[#8b949e]">
                  {t("ratingThumbsDown")}
                </span>
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 text-sm text-[#8b949e] hover:text-[#e6edf3]"
            >
              {t("ratingSkip")}
            </button>
          </>
        ) : phase === "reason" ? (
          <>
            <p className="mb-5 text-lg font-medium text-[#e6edf3]">
              {t("ratingReasonPrompt")}
            </p>
            <div className="flex flex-col gap-2">
              {OCR_RATING_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => void handleReason(reason)}
                  className="w-full rounded-xl border border-[#30363d] px-4 py-2.5 text-left text-sm text-[#e6edf3] transition-colors hover:border-[#58a6ff] hover:bg-[#58a6ff10]"
                >
                  {t(`ratingReason_${reason}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 text-sm text-[#8b949e] hover:text-[#e6edf3]"
            >
              {t("ratingSkip")}
            </button>
          </>
        ) : (
          <>
            <p className="mb-6 text-lg font-medium text-[#e6edf3]">
              {t("ratingThankYou")}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
            >
              {t("ratingClose")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
