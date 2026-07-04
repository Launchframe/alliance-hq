"use client";

import { useTranslations } from "next-intl";

import {
  resolveOcrAccuracyBadge,
  type VideoOcrAccuracy,
} from "@/lib/video/ocr-accuracy";

type Props = {
  level: VideoOcrAccuracy;
  /** Id of the caption element explaining badge semantics (e.g. under the select). */
  describedBy?: string;
};

export function OcrAccuracyBadge({ level, describedBy }: Props) {
  const t = useTranslations("video");
  const badge = resolveOcrAccuracyBadge(level);
  const shortLabel = t(badge.labelKey);

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${badge.className}`}
      aria-describedby={describedBy}
    >
      {shortLabel}
    </span>
  );
}
