"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  copyConductorWheelSharePngToClipboard,
  downloadConductorWheelSharePng,
} from "@/lib/client/conductor-wheel-share-image.client";

export type ConductorWheelSharePreview = {
  blob: Blob;
  url: string;
  filename: string;
};

type Props = {
  open: boolean;
  preview: ConductorWheelSharePreview | null;
  onClose: () => void;
  /** Overlay stacking; wheel modal uses 210 so it sits above the spin dialog. */
  zIndexClassName?: string;
};

export function ConductorWheelSharePreviewDialog({
  open,
  preview,
  onClose,
  zIndexClassName = "z-[210]",
}: Props) {
  const t = useTranslations("trains.wheel");
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"copied" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (copyFeedback !== "copied") return;
    const timer = window.setTimeout(() => setCopyFeedback(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const handleClose = useCallback(() => {
    setCopyBusy(false);
    setCopyFeedback(null);
    setCopyError(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, handleClose]);

  const handleCopy = useCallback(async () => {
    if (!preview) return;
    setCopyBusy(true);
    setCopyError(null);
    try {
      await copyConductorWheelSharePngToClipboard(preview.blob);
      setCopyFeedback("copied");
    } catch {
      setCopyError(t("share.copyFailed"));
      setCopyFeedback(null);
    } finally {
      setCopyBusy(false);
    }
  }, [preview, t]);

  const handleDownload = useCallback(() => {
    if (!preview) return;
    downloadConductorWheelSharePng(preview.blob, preview.filename);
  }, [preview]);

  if (!open || !preview) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center bg-black/80 p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conductor-wheel-share-preview-title"
      data-testid="trains-wheel-share-preview"
    >
      <div className="flex w-full max-w-md flex-col rounded-2xl border border-hq-border bg-hq-surface p-5 shadow-2xl">
        <h2
          id="conductor-wheel-share-preview-title"
          className="text-center text-sm font-semibold uppercase tracking-wide text-hq-fg-muted"
        >
          {t("share.previewTitle")}
        </h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-hq-border bg-hq-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob preview URL */}
          <img
            src={preview.url}
            alt={t("share.previewTitle")}
            className="mx-auto max-h-[min(60vh,720px)] w-full object-contain"
          />
        </div>
        {copyError ? (
          <p className="mt-3 text-center text-sm text-hq-danger" role="alert">
            {copyError}
          </p>
        ) : copyFeedback === "copied" ? (
          <p className="mt-3 text-center text-sm text-hq-success" role="status">
            {t("share.copied")}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
            >
              {t("share.closePreview")}
            </button>
          <button
            type="button"
            data-testid="trains-wheel-share-download"
            onClick={handleDownload}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
          >
            {t("share.download")}
          </button>
          <button
            type="button"
            disabled={copyBusy}
            data-testid="trains-wheel-share-copy-media"
            onClick={() => void handleCopy()}
            className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#8250df] disabled:opacity-50"
          >
            {t("share.copyMedia")}
          </button>
        </div>
      </div>
    </div>
  );
}
