"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload, X } from "lucide-react";
import type { Slide } from "yet-another-react-lightbox";

import { Dialog } from "@/components/ui/dialog";
import { ScreenshotLightbox } from "@/components/ui/ScreenshotLightbox";
import { useRouter } from "@/i18n/navigation";
import type { ParsedCityListBank } from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import {
  clearCityListImportDraft,
  readCityListImportDraft,
  writeCityListImportDraft,
  type CityListImportDraftRow,
} from "@/lib/banks/city-list-import-draft.shared";
import {
  clearCityListImportScreenshotPreviews,
  setCityListImportScreenshotPreviews,
} from "@/lib/banks/city-list-import-session.client";

type ParseCityListResponse = {
  snapshot?: {
    capturedCount: number | null;
    capturedLimit: number | null;
    capturesRemainingToday: number | null;
    capturesLimitToday: number | null;
    serverTime: string | null;
    isComplete: boolean;
  };
  banks?: ParsedCityListBank[];
  error?: string;
};

type SelectedScreenshot = {
  id: string;
  file: File;
  previewUrl: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allianceId: string;
};

function newRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newScreenshotId(): string {
  return `shot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function rowsFromParse(banks: ParsedCityListBank[]): CityListImportDraftRow[] {
  return banks.map((bank) => ({
    rowKey: newRowKey(),
    gameServerNumber: bank.gameServerNumber,
    coordX: bank.coordX,
    coordY: bank.coordY,
    level: bank.level,
    currentDepositValue: bank.crystalGoldValue,
    currentDepositCount: bank.currentDepositCount,
  }));
}

/**
 * Upload-only modal: parse City List screenshots, write the review draft,
 * then navigate to `/bank-management/import-review`.
 */
export function CityListImportModal({
  open,
  onOpenChange,
  allianceId,
}: Props) {
  const t = useTranslations("bankManagement");
  const router = useRouter();
  const [screenshots, setScreenshots] = useState<SelectedScreenshot[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotsRef = useRef<SelectedScreenshot[]>([]);

  useEffect(() => {
    screenshotsRef.current = screenshots;
  }, [screenshots]);

  const revokeScreenshots = useCallback((shots: SelectedScreenshot[]) => {
    for (const shot of shots) {
      URL.revokeObjectURL(shot.previewUrl);
    }
  }, []);

  const clearScreenshots = useCallback(() => {
    revokeScreenshots(screenshotsRef.current);
    setScreenshots([]);
    setLightboxIndex(null);
  }, [revokeScreenshots]);

  const reset = useCallback(() => {
    setError(null);
    setParsing(false);
    clearScreenshots();
  }, [clearScreenshots]);

  useEffect(() => {
    return () => {
      revokeScreenshots(screenshotsRef.current);
    };
  }, [revokeScreenshots]);

  const hasDraft =
    open && readCityListImportDraft(allianceId) != null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: SelectedScreenshot[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      next.push({
        id: newScreenshotId(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (next.length === 0) return;
    setScreenshots((prev) => [...prev, ...next]);
    setError(null);
  }, []);

  const removeScreenshot = useCallback((id: string) => {
    setScreenshots((prev) => {
      const target = prev.find((shot) => shot.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((shot) => shot.id !== id);
    });
    setLightboxIndex(null);
  }, []);

  const continueExistingDraft = useCallback(() => {
    handleOpenChange(false);
    router.push("/bank-management/import-review");
  }, [handleOpenChange, router]);

  const parseSelected = useCallback(async () => {
    if (screenshots.length === 0) return;
    setParsing(true);
    setError(null);

    try {
      const form = new FormData();
      for (const shot of screenshots) {
        form.append("images", shot.file);
      }
      const res = await fetch("/api/banks/city-list/parse", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as
        | ParseCityListResponse
        | null;
      if (!res.ok || !body) {
        throw new Error(body?.error ?? t("cityListParseFailed"));
      }

      const parsedRows = rowsFromParse(body.banks ?? []);
      if (parsedRows.length === 0) {
        throw new Error(t("cityListParseFailed"));
      }

      clearCityListImportDraft(allianceId);
      writeCityListImportDraft(allianceId, {
        version: 1,
        rows: parsedRows,
        snapshot: body.snapshot ?? null,
      });

      // Hand off preview URLs without revoking — review page owns them.
      clearCityListImportScreenshotPreviews();
      setCityListImportScreenshotPreviews(
        screenshots.map((shot) => ({
          id: shot.id,
          previewUrl: shot.previewUrl,
          name: shot.file.name,
        })),
      );
      screenshotsRef.current = [];
      setScreenshots([]);

      handleOpenChange(false);
      router.push("/bank-management/import-review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cityListParseFailed"));
    } finally {
      setParsing(false);
    }
  }, [
    allianceId,
    handleOpenChange,
    router,
    screenshots,
    t,
  ]);

  const lightboxSlides: Slide[] = screenshots.map((shot) => ({
    src: shot.previewUrl,
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("cityListImportTitle")}
      ignoreOutsideDismiss={lightboxIndex !== null}
      className="w-full max-w-[min(96vw,36rem)]"
    >
      <div className="min-w-0 space-y-4">
        <h2 className="text-lg font-semibold text-hq-fg">
          {t("cityListImportTitle")}
        </h2>
        <p className="text-sm text-hq-fg-muted">{t("cityListImportHint")}</p>

        {hasDraft ? (
          <div className="rounded-lg border border-hq-accent/40 bg-hq-accent/10 px-3 py-2 text-sm text-hq-fg">
            <p>{t("cityListDraftRestored")}</p>
            <button
              type="button"
              className="mt-2 rounded border border-hq-accent px-3 py-1.5 text-xs font-medium text-hq-fg"
              onClick={continueExistingDraft}
            >
              {t("cityListReviewPageTitle")}
            </button>
          </div>
        ) : null}

        <label className="flex min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hq-border bg-hq-canvas px-6 py-10 text-center text-sm text-hq-fg-muted hover:border-hq-accent">
          <Upload className="h-6 w-6" aria-hidden />
          <span>{t("cityListAddScreenshots")}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="sr-only"
            disabled={parsing}
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        {screenshots.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-hq-fg-muted">
                {t("cityListSelectedCount", { count: screenshots.length })}
              </p>
              <button
                type="button"
                className="rounded border border-hq-border px-2.5 py-1 text-xs text-hq-fg-muted hover:text-hq-fg"
                onClick={clearScreenshots}
                disabled={parsing}
              >
                {t("cityListClearScreenshots")}
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {screenshots.map((shot, index) => (
                <li key={shot.id} className="relative">
                  <button
                    type="button"
                    className="block w-full overflow-hidden rounded-lg border border-hq-border bg-hq-canvas"
                    onClick={() => setLightboxIndex(index)}
                    aria-label={t("cityListThumbnailPreview")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={shot.previewUrl}
                      alt=""
                      className="aspect-[3/4] w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full border border-hq-border bg-hq-canvas/90 p-1 text-hq-fg-muted hover:text-hq-danger"
                    aria-label={t("cityListRemoveScreenshot")}
                    onClick={() => removeScreenshot(shot.id)}
                    disabled={parsing}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
            onClick={() => handleOpenChange(false)}
            disabled={parsing}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void parseSelected()}
            disabled={parsing || screenshots.length === 0}
          >
            {parsing ? t("actions.saving") : t("cityListParseSelected")}
          </button>
        </div>
      </div>

      <ScreenshotLightbox
        open={
          lightboxIndex !== null && lightboxIndex < lightboxSlides.length
        }
        index={lightboxIndex ?? 0}
        slides={lightboxSlides}
        onClose={() => setLightboxIndex(null)}
        closeLabel={t("cityListClosePreview")}
      />
    </Dialog>
  );
}
