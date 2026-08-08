"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

type Props = {
  currentIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
};

export function ReviewIssueNav({
  currentIndex,
  total,
  onPrev,
  onNext,
}: Props) {
  const t = useTranslations("videoReview");

  if (total === 0) return null;

  return (
    <div
      className="sticky z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-hq-border bg-hq-canvas/95 px-4 py-2 backdrop-blur md:-mx-0 md:px-0"
      style={{ top: "3.25rem" }}
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
        className="inline-flex items-center rounded-md border border-hq-border p-1.5 text-hq-fg hover:bg-hq-surface-muted"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label={t("reviewNavNext")}
        className="inline-flex items-center rounded-md border border-hq-border p-1.5 text-hq-fg hover:bg-hq-surface-muted"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
