"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Upload, X } from "lucide-react";
import type { Slide } from "yet-another-react-lightbox";

import { Dialog } from "@/components/ui/dialog";
import { ScreenshotLightbox } from "@/components/ui/ScreenshotLightbox";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import type { ParsedCityListBank } from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import { formatCityListServerTime } from "@/lib/banks/city-list-server-time.shared";
import type { BankManagementPayload, BankWithSlips } from "@/lib/banks/types.shared";

type ReviewRow = {
  rowKey: string;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  currentDepositValue: number | null;
  currentDepositCount: number | null;
};

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
  warnings?: string[];
  error?: string;
};

type ImportCityListResponse = {
  dashboard?: BankManagementPayload;
  warnings?: string[];
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
  existingBanks: BankWithSlips[];
  onImported: (dashboard: BankManagementPayload) => void;
};

function newRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newScreenshotId(): string {
  return `shot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function rowsFromParse(banks: ParsedCityListBank[]): ReviewRow[] {
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

function bankKey(server: number, x: number, y: number): string {
  return `${server}:${x}:${y}`;
}

export function CityListImportModal({
  open,
  onOpenChange,
  existingBanks,
  onImported,
}: Props) {
  const t = useTranslations("bankManagement");
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [screenshots, setScreenshots] = useState<SelectedScreenshot[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [snapshot, setSnapshot] = useState<
    ParseCityListResponse["snapshot"] | null
  >(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
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
    setStep("upload");
    setRows([]);
    setSnapshot(null);
    setError(null);
    setParsing(false);
    setImporting(false);
    clearScreenshots();
  }, [clearScreenshots]);

  useEffect(() => {
    return () => {
      revokeScreenshots(screenshotsRef.current);
    };
  }, [revokeScreenshots]);

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

      setRows(parsedRows);
      setSnapshot(body.snapshot ?? null);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cityListParseFailed"));
    } finally {
      setParsing(false);
    }
  }, [screenshots, t]);

  const updateRow = useCallback(
    (rowKey: string, patch: Partial<ReviewRow>) => {
      setRows((prev) =>
        prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const removeRow = useCallback((rowKey: string) => {
    setRows((prev) => prev.filter((row) => row.rowKey !== rowKey));
  }, []);

  const rowKeys = useMemo(
    () =>
      new Set(
        rows.map((row) => bankKey(row.gameServerNumber, row.coordX, row.coordY)),
      ),
    [rows],
  );

  const showIncompleteWarning =
    snapshot?.capturedCount != null && rows.length < snapshot.capturedCount;

  const isCompleteImport =
    snapshot?.capturedCount != null && rows.length === snapshot.capturedCount;

  const hasDuplicateCoords = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = bankKey(row.gameServerNumber, row.coordX, row.coordY);
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }, [rows]);

  const extraHqBankCount = useMemo(
    () =>
      existingBanks.filter(
        (bank) =>
          !rowKeys.has(
            bankKey(bank.gameServerNumber, bank.coordX, bank.coordY),
          ),
      ).length,
    [existingBanks, rowKeys],
  );
  const showExtraHqWarning = isCompleteImport && extraHqBankCount > 0;

  const lightboxSlides = useMemo<Slide[]>(
    () => screenshots.map((shot) => ({ src: shot.previewUrl })),
    [screenshots],
  );

  const commit = useCallback(async () => {
    if (rows.length === 0 || importing || hasDuplicateCoords) return;
    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/banks/city-list/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          banks: rows.map((row) => ({
            gameServerNumber: row.gameServerNumber,
            coordX: row.coordX,
            coordY: row.coordY,
            level: row.level,
            currentDepositValue: row.currentDepositValue,
            currentDepositCount: row.currentDepositCount,
          })),
          capturedCount: snapshot?.capturedCount ?? null,
          capturedLimit: snapshot?.capturedLimit ?? null,
          capturesRemainingToday: snapshot?.capturesRemainingToday ?? null,
          capturesLimitToday: snapshot?.capturesLimitToday ?? null,
          serverTime: snapshot?.serverTime ?? null,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | ImportCityListResponse
        | null;
      if (!res.ok || !body?.dashboard) {
        throw new Error(body?.error ?? t("cityListParseFailed"));
      }

      onImported(body.dashboard);
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cityListParseFailed"));
    } finally {
      setImporting(false);
    }
  }, [handleOpenChange, hasDuplicateCoords, importing, onImported, rows, snapshot, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("cityListImportTitle")}
      className="w-full max-w-[min(96vw,52rem)]"
    >
      <div className="min-w-0 space-y-4">
        <h2 className="text-lg font-semibold text-hq-fg">
          {t("cityListImportTitle")}
        </h2>

        {step === "upload" ? (
          <div className="min-w-0 space-y-4">
            <p className="text-sm text-hq-fg-muted">{t("cityListImportHint")}</p>

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
                    {t("cityListSelectedCount", {
                      count: screenshots.length,
                    })}
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
        ) : (
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void commit();
            }}
          >
            {snapshot?.serverTime || snapshot?.capturesRemainingToday != null ? (
              <div className="flex flex-wrap gap-2 text-xs text-hq-fg-muted">
                {snapshot?.serverTime ? (
                  <span className="rounded-full border border-hq-border px-2.5 py-1">
                    {t("cityListServerTime", {
                      time: formatCityListServerTime(snapshot.serverTime),
                    })}
                  </span>
                ) : null}
                {snapshot?.capturesRemainingToday != null &&
                snapshot?.capturesLimitToday != null ? (
                  <span className="rounded-full border border-hq-border px-2.5 py-1">
                    {t("capturesLeftToday", {
                      remaining: snapshot.capturesRemainingToday,
                      limit: snapshot.capturesLimitToday,
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {showIncompleteWarning ? (
              <div className="rounded-lg border border-hq-warning/40 bg-hq-warning/10 px-3 py-2 text-sm text-hq-warning">
                {t("cityListIncompleteWarning")}
              </div>
            ) : null}
            {showExtraHqWarning ? (
              <div className="rounded-lg border border-hq-warning/40 bg-hq-warning/10 px-3 py-2 text-sm text-hq-warning">
                {t("cityListExtraHqWarning")}
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-lg border border-hq-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-hq-canvas text-xs text-hq-fg-muted">
                  <tr>
                    <th className="px-3 py-2">{t("fields.level")}</th>
                    <th className="px-3 py-2">{t("fields.server")}</th>
                    <th className="px-3 py-2">{t("fields.coordX")}</th>
                    <th className="px-3 py-2">{t("fields.coordY")}</th>
                    <th className="px-3 py-2">{t("fields.amount")}</th>
                    <th className="px-3 py-2">{t("depositsTitle")}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowKey} className="border-t border-hq-border">
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="w-16 min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.level}
                          onChange={(event) =>
                            updateRow(row.rowKey, {
                              level: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="w-20 min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.gameServerNumber}
                          onChange={(event) =>
                            updateRow(row.rowKey, {
                              gameServerNumber: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step={1}
                          className="w-20 min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.coordX}
                          onChange={(event) =>
                            updateRow(row.rowKey, {
                              coordX: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step={1}
                          className="w-20 min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.coordY}
                          onChange={(event) =>
                            updateRow(row.rowKey, {
                              coordY: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-28 min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.currentDepositValue ?? ""}
                          onChange={(event) =>
                            updateRow(row.rowKey, {
                              currentDepositValue: event.target.value
                                ? Number(event.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          className="w-16 min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.currentDepositCount ?? ""}
                          onChange={(event) =>
                            updateRow(row.rowKey, {
                              currentDepositCount: event.target.value
                                ? Number(event.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-label={t("actions.delete")}
                          className="rounded border border-hq-border p-1.5 text-hq-fg-muted hover:border-hq-danger hover:text-hq-danger"
                          onClick={() => removeRow(row.rowKey)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
                onClick={() => setStep("upload")}
                disabled={importing}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="submit"
                className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={importing || rows.length === 0 || hasDuplicateCoords}
              >
                {importing ? t("actions.saving") : t("cityListConfirmImport")}
              </button>
            </div>
          </form>
        )}
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
