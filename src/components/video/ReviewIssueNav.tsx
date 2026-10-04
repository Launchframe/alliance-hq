"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { PREVIEW_HEADER_OFFSET } from "@/lib/video/preview-layout";

type Props = {
  currentIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  /** CSS `top` for sticky positioning (header, or header + top preview dock). */
  stickyTop?: string;
};

export function ReviewIssueNav({
  currentIndex,
  total,
  onPrev,
  onNext,
  stickyTop = PREVIEW_HEADER_OFFSET,
}: Props) {
  const t = useTranslations("videoReview");

  if (total === 0) return null;

  return (
    <div
      className="sticky z-[25] -mx-4 flex flex-wrap items-center gap-2 border-b border-hq-border bg-hq-canvas/95 px-4 py-2 backdrop-blur md:-mx-0 md:px-0"
      style={{ top: stickyTop }}
    >
      <span className="text-sm text-hq-fg-muted">
        {t("reviewNavCounter", {
          current: currentIndex + 1,
          total,
        })}
      </span>
      <button
        type="button"
        onClick={onPrev}
        aria-label={t("reviewNavPrev")}
        className="inline-flex touch-manipulation items-center rounded-md border border-hq-border p-2 text-hq-fg hover:bg-hq-surface-muted"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label={t("reviewNavNext")}
        className="inline-flex touch-manipulation items-center rounded-md border border-hq-border p-2 text-hq-fg hover:bg-hq-surface-muted"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
