"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { useReleaseNotes } from "@/components/release-notes/ReleaseNotesProvider";

export function ReleaseNoticeBanner() {
  const t = useTranslations("releaseNotes");
  const { hasUnread, canOpenReleaseNotes, openReleaseNotes, dismissReleaseNotes } =
    useReleaseNotes();

  if (!hasUnread) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="hq-release-notice-banner"
      className="shrink-0 border-b border-amber-500/40 bg-amber-950/90 px-3 py-2 text-center text-xs leading-snug text-amber-100 sm:text-sm"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-2">
        <p className="min-w-0 flex-1">
          {t("bannerPrefix")}{" "}
          {canOpenReleaseNotes ? (
            <button
              type="button"
              onClick={openReleaseNotes}
              className="font-medium text-amber-50 underline decoration-amber-200/70 underline-offset-2 hover:text-white"
              data-testid="hq-release-notice-banner-version-link"
            >
              {t("bannerVersionLink")}
            </button>
          ) : (
            <span>{t("bannerVersionLink")}</span>
          )}
        </p>
        <button
          type="button"
          onClick={dismissReleaseNotes}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-amber-100 hover:bg-amber-900/60 hover:text-white"
          aria-label={t("dismissBanner")}
          data-testid="hq-release-notice-banner-dismiss"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
