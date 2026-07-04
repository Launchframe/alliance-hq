"use client";

import { useTranslations } from "next-intl";

import {
  resolveOcrAccuracyBadge,
  type VideoOcrAccuracy,
} from "@/lib/video/ocr-accuracy";

type Props = {
  level: VideoOcrAccuracy;
};

export function OcrAccuracyBadge({ level }: Props) {
  const t = useTranslations("video");
  const badge = resolveOcrAccuracyBadge(level);
  const shortLabel = t(badge.labelKey);
  const description = t("ocrAccuracy.label");

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${badge.className}`}
      title={description}
      aria-label={`${shortLabel}. ${description}`}
    >
      {shortLabel}
    </span>
  );
}
