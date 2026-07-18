"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import type { Slide } from "yet-another-react-lightbox";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { THP_BREAKDOWN_KEYS, type ThpBreakdown } from "@/lib/thp/my-thp.shared";
import { ScreenshotLightbox } from "@/components/ui/ScreenshotLightbox";

type Draft = Record<keyof ThpBreakdown, string>;

function draftFromBreakdown(breakdown: ThpBreakdown | Partial<ThpBreakdown> | null): Draft {
  const draft = {} as Draft;
  for (const key of THP_BREAKDOWN_KEYS) {
    const value = breakdown?.[key];
    draft[key] = value != null && value > 0 ? String(value) : "";
  }
  return draft;
}

function parseDraft(draft: Draft): ThpBreakdown {
  const breakdown = {} as ThpBreakdown;
  for (const key of THP_BREAKDOWN_KEYS) {
    const parsed = Number.parseInt(draft[key], 10);
    breakdown[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return breakdown;
}

type Props = {
  initial: ThpBreakdown | Partial<ThpBreakdown> | null;
  busy: boolean;
  onSubmit: (breakdown: ThpBreakdown) => void;
  onCancel: () => void;
  screenshotPreviewUrl?: string | null;
  partialHint?: string | null;
};

export function ThpBreakdownForm({
  initial,
  busy,
  onSubmit,
  onCancel,
  screenshotPreviewUrl,
  partialHint,
}: Props) {
  const t = useTranslations("myThp");
  const [draft, setDraft] = useState<Draft>(() => draftFromBreakdown(initial));
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const total = useMemo(() => {
    return THP_BREAKDOWN_KEYS.reduce((sum, key) => {
      const parsed = Number.parseInt(draft[key], 10);
      return sum + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    }, 0);
  }, [draft]);

  const lightboxSlides = useMemo<Slide[]>(
    () => (screenshotPreviewUrl ? [{ src: screenshotPreviewUrl }] : []),
    [screenshotPreviewUrl],
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        preventDefaultFormSubmit(event);
        onSubmit(parseDraft(draft));
      }}
      data-testid="my-thp-breakdown-form"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{t("breakdownDialogTitle")}</h2>
          <p className="text-sm text-hq-fg-muted">{t("breakdownDialogDescription")}</p>
        </div>
        {screenshotPreviewUrl ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hq-border px-3 py-2 text-xs font-medium text-hq-fg hover:border-hq-accent"
            data-testid="my-thp-breakdown-preview-btn"
          >
            <Eye className="h-4 w-4" aria-hidden />
            {t("breakdownPreviewScreenshot")}
          </button>
        ) : null}
      </div>

      {partialHint ? (
        <p
          className="rounded-lg border border-hq-warning/50 bg-hq-warning/10 px-3 py-2 text-sm text-hq-warning"
          data-testid="my-thp-ocr-partial-hint"
        >
          {partialHint}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THP_BREAKDOWN_KEYS.map((key) => (
          <label key={key} className="block space-y-1">
            <span className="text-sm font-medium text-hq-fg">
              {t(`breakdownFields.${key}`)}
            </span>
            <input
              type="number"
              step={1}
              min={0}
              inputMode="numeric"
              value={draft[key]}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, [key]: e.target.value }))
              }
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
              data-testid={`my-thp-breakdown-field-${key}`}
            />
          </label>
        ))}
      </div>

      <p className="font-mono text-sm text-hq-fg-muted" data-testid="my-thp-breakdown-sum">
        {t("breakdownTotalLabel", { total: total.toLocaleString() })}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="submit"
          disabled={busy || total <= 0}
          className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t("breakdownSubmit")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg"
        >
          {t("cancel")}
        </button>
      </div>

      <ScreenshotLightbox
        open={lightboxOpen && lightboxSlides.length > 0}
        index={0}
        slides={lightboxSlides}
        onClose={() => setLightboxOpen(false)}
        closeLabel={t("breakdownClosePreview")}
      />
    </form>
  );
}
