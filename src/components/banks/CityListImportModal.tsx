"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Eye, Plus, Trash2, Upload, X } from "lucide-react";
import type { Slide } from "yet-another-react-lightbox";

import { Dialog } from "@/components/ui/dialog";
import { ScreenshotLightbox } from "@/components/ui/ScreenshotLightbox";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { CityListImportResetDialog } from "@/components/banks/CityListImportResetDialog";
import {
  clearCityListImportDraft,
  readCityListImportDraft,
  writeCityListImportDraft,
} from "@/lib/banks/city-list-import-draft.shared";
import type { ParsedCityListBank } from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import {
  cityListReviewRowsHaveErrors,
  clampReviewIndexAfterRemove,
  defaultPlaceholderGameServerNumber,
  isCityListPlaceholderCoords,
  missingRowCountForCapturedCount,
  validateCityListReviewRow,
  type CityListRowErrors,
  type CityListRowFieldName,
} from "@/lib/banks/city-list-import-review.shared";
import { formatCityListServerTime } from "@/lib/banks/city-list-server-time.shared";
import {
  bankDepositCapacity,
  type BankManagementPayload,
  type BankWithSlips,
} from "@/lib/banks/types.shared";

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

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

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

function buildPlaceholderRow(gameServerNumber: number): ReviewRow {
  return {
    rowKey: newRowKey(),
    gameServerNumber,
    coordX: 0,
    coordY: 0,
    level: 1,
    currentDepositValue: null,
    currentDepositCount: null,
  };
}

function bankKey(server: number, x: number, y: number): string {
  return `${server}:${x}:${y}`;
}

type RowFieldName = CityListRowFieldName;
type RowErrors = CityListRowErrors;

function touchKey(rowKey: string, field: RowFieldName): string {
  return `${rowKey}:${field}`;
}

type FieldLabels = {
  level: string;
  server: string;
  coordX: string;
  coordY: string;
  amount: string;
  deposits: string;
};

function BankReviewCardFields({
  row,
  labels,
  errors,
  showErrors,
  onTouchField,
  onChange,
}: {
  row: ReviewRow;
  labels: FieldLabels;
  errors: RowErrors;
  showErrors: (field: RowFieldName) => boolean;
  onTouchField: (field: RowFieldName) => void;
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const inputBase =
    "w-full min-w-0 rounded border bg-hq-canvas px-3 py-2 text-sm text-hq-fg";
  const inputOk = `${inputBase} border-hq-border`;
  const inputErr = `${inputBase} border-hq-danger`;

  const depositMax = bankDepositCapacity(row.level);

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block space-y-1 text-xs text-hq-fg-muted">
        <span>{labels.level}</span>
        <input
          type="number"
          min={1}
          step={1}
          className={showErrors("level") && errors.level ? inputErr : inputOk}
          value={row.level}
          onChange={(event) =>
            onChange({ level: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("level")}
        />
        {showErrors("level") && errors.level ? (
          <span className="text-hq-danger">{errors.level}</span>
        ) : null}
      </label>
      <label className="block space-y-1 text-xs text-hq-fg-muted">
        <span>{labels.server}</span>
        <input
          type="number"
          min={1}
          step={1}
          className={
            showErrors("gameServerNumber") && errors.gameServerNumber
              ? inputErr
              : inputOk
          }
          value={row.gameServerNumber}
          onChange={(event) =>
            onChange({ gameServerNumber: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("gameServerNumber")}
        />
        {showErrors("gameServerNumber") && errors.gameServerNumber ? (
          <span className="text-hq-danger">{errors.gameServerNumber}</span>
        ) : null}
      </label>
      <label className="block space-y-1 text-xs text-hq-fg-muted">
        <span>{labels.coordX}</span>
        <input
          type="number"
          step={1}
          className={showErrors("coordX") && errors.coordX ? inputErr : inputOk}
          value={row.coordX}
          onChange={(event) =>
            onChange({ coordX: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("coordX")}
        />
        {showErrors("coordX") && errors.coordX ? (
          <span className="text-hq-danger">{errors.coordX}</span>
        ) : null}
      </label>
      <label className="block space-y-1 text-xs text-hq-fg-muted">
        <span>{labels.coordY}</span>
        <input
          type="number"
          step={1}
          className={showErrors("coordY") && errors.coordY ? inputErr : inputOk}
          value={row.coordY}
          onChange={(event) =>
            onChange({ coordY: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("coordY")}
        />
        {showErrors("coordY") && errors.coordY ? (
          <span className="text-hq-danger">{errors.coordY}</span>
        ) : null}
      </label>
      <label className="block space-y-1 text-xs text-hq-fg-muted">
        <span>{labels.amount}</span>
        <input
          type="number"
          min={0}
          step={1}
          className={inputOk}
          value={row.currentDepositValue ?? ""}
          onChange={(event) =>
            onChange({
              currentDepositValue: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
        />
      </label>
      <label className="block space-y-1 text-xs text-hq-fg-muted">
        <span>{labels.deposits}</span>
        <input
          type="number"
          min={0}
          max={depositMax}
          step={1}
          className={inputOk}
          value={row.currentDepositCount ?? ""}
          onChange={(event) =>
            onChange({
              currentDepositCount: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
        />
      </label>
    </div>
  );
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
  const [reviewIndex, setReviewIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [snapshot, setSnapshot] = useState<
    ParseCityListResponse["snapshot"] | null
  >(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotsRef = useRef<SelectedScreenshot[]>([]);
  const draftHydrationAttemptedRef = useRef(false);
  const suppressDraftClearRef = useRef(false);

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
    // Emptying `rows` here must not be mistaken by the auto-save effect
    // below for the user clearing their review — it should leave any
    // already-persisted draft alone so an accidental close can recover it.
    suppressDraftClearRef.current = true;
    setStep("upload");
    setRows([]);
    setReviewIndex(0);
    setPreviewIndex(0);
    setSnapshot(null);
    setError(null);
    setTouched(new Set());
    setSubmitAttempted(false);
    setDraftRestored(false);
    setParsing(false);
    setImporting(false);
    clearScreenshots();
  }, [clearScreenshots]);

  // Closing the modal (accidentally via Escape/overlay click, or after a
  // successful import) clears in-memory state via `reset()` above, but must
  // NOT touch the sessionStorage draft — that is what lets an accidental
  // close be recovered from. Only an explicit Reset, or a successful
  // import, clears the persisted draft.
  const resetAndClearDraft = useCallback(() => {
    clearCityListImportDraft();
    reset();
  }, [reset]);

  useEffect(() => {
    return () => {
      revokeScreenshots(screenshotsRef.current);
    };
  }, [revokeScreenshots]);

  // Restore a previously auto-saved review (e.g. after an accidental
  // Escape/overlay-click close, or a page refresh) once per open session.
  useEffect(() => {
    if (!open) {
      draftHydrationAttemptedRef.current = false;
      return;
    }
    if (draftHydrationAttemptedRef.current) return;
    draftHydrationAttemptedRef.current = true;

    setRows((currentRows) => {
      if (currentRows.length > 0) return currentRows;
      const draft = readCityListImportDraft();
      if (!draft) return currentRows;
      setSnapshot(draft.snapshot);
      setStep("review");
      setDraftRestored(true);
      return draft.rows;
    });
  }, [open]);

  // Auto-save the in-progress review so an accidental modal close doesn't
  // lose it. Deliberately does not depend on `open` — the last edit before
  // an accidental close is already captured by the time close fires.
  useEffect(() => {
    if (rows.length === 0) {
      if (suppressDraftClearRef.current) {
        suppressDraftClearRef.current = false;
        return;
      }
      clearCityListImportDraft();
      return;
    }
    writeCityListImportDraft({ version: 1, rows, snapshot: snapshot ?? null });
  }, [rows, snapshot]);

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

      // Leverage the "Bank Strongholds captured: N/M" header as an
      // independent anchor: if OCR recovered fewer tiles than N, pad the
      // review list with blank rows so the officer sees exactly how many
      // banks are missing and can fill them in manually, instead of
      // silently importing an incomplete list.
      const missingCount = missingRowCountForCapturedCount(
        parsedRows.length,
        body.snapshot?.capturedCount ?? null,
        body.snapshot?.capturedLimit ?? null,
      );
      const defaultGameServerNumber = defaultPlaceholderGameServerNumber(
        parsedRows.map((row) => row.gameServerNumber),
        existingBanks.map((bank) => bank.gameServerNumber),
      );
      const paddedRows =
        missingCount > 0
          ? [
              ...parsedRows,
              ...Array.from({ length: missingCount }, () =>
                buildPlaceholderRow(defaultGameServerNumber),
              ),
            ]
          : parsedRows;

      setRows(paddedRows);
      setReviewIndex(0);
      setPreviewIndex(0);
      setSnapshot(body.snapshot ?? null);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cityListParseFailed"));
    } finally {
      setParsing(false);
    }
  }, [existingBanks, screenshots, t]);

  const updateRow = useCallback(
    (rowKey: string, patch: Partial<ReviewRow>) => {
      setRows((prev) =>
        prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const removeRow = useCallback((rowKey: string) => {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.rowKey === rowKey);
      if (index < 0) return prev;
      const next = prev.filter((row) => row.rowKey !== rowKey);
      queueMicrotask(() => {
        setReviewIndex((current) =>
          clampReviewIndexAfterRemove(current, index, next.length),
        );
      });
      return next;
    });
  }, []);

  const touchField = useCallback((rowKey: string, field: RowFieldName) => {
    setTouched((prev) => {
      const key = touchKey(rowKey, field);
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    const defaultGameServerNumber = defaultPlaceholderGameServerNumber(
      rows.map((row) => row.gameServerNumber),
      existingBanks.map((bank) => bank.gameServerNumber),
    );
    const newRow = buildPlaceholderRow(defaultGameServerNumber);
    setRows((prev) => {
      const next = [...prev, newRow];
      queueMicrotask(() => setReviewIndex(next.length - 1));
      return next;
    });
  }, [existingBanks, rows]);

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
      // Placeholder (0, 0) rows are already invalid until filled; multiple
      // captured-count pads must not surface as coordinate collisions.
      if (isCityListPlaceholderCoords(row.coordX, row.coordY)) continue;
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

  const activeRow = rows[reviewIndex] ?? null;
  const progressPercent =
    rows.length > 0 ? ((reviewIndex + 1) / rows.length) * 100 : 0;

  const fieldLabels: FieldLabels = {
    level: t("fields.level"),
    server: t("fields.server"),
    coordX: t("fields.coordX"),
    coordY: t("fields.coordY"),
    amount: t("fields.amount"),
    deposits: t("depositsTitle"),
  };

  const requiredMsg = t("cityListValidationRequired");
  const levelMinMsg = t("cityListValidationLevelMin");

  const showFieldError = useCallback(
    (rowKey: string, field: RowFieldName): boolean =>
      submitAttempted || touched.has(touchKey(rowKey, field)),
    [submitAttempted, touched],
  );

  const rowValidationErrors = useMemo(
    () =>
      new Map<string, RowErrors>(
        rows.map((row) => [
          row.rowKey,
          validateCityListReviewRow(row, requiredMsg, levelMinMsg),
        ]),
      ),
    [rows, requiredMsg, levelMinMsg],
  );

  const commit = useCallback(async () => {
    if (rows.length === 0 || importing) return;

    setSubmitAttempted(true);

    if (
      hasDuplicateCoords ||
      cityListReviewRowsHaveErrors(rows, requiredMsg, levelMinMsg)
    ) {
      return;
    }
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

      clearCityListImportDraft();
      onImported(body.dashboard);
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cityListParseFailed"));
    } finally {
      setImporting(false);
    }
  }, [handleOpenChange, hasDuplicateCoords, importing, levelMinMsg, onImported, requiredMsg, rows, snapshot, t]);

  const openPreview = useCallback(
    (index = previewIndex) => {
      if (screenshots.length === 0) return;
      const clamped = Math.min(Math.max(index, 0), screenshots.length - 1);
      setPreviewIndex(clamped);
      setLightboxIndex(clamped);
    },
    [previewIndex, screenshots.length],
  );

  const reviewMeta = (
    <>
      {draftRestored ? (
        <div className="rounded-lg border border-hq-accent/40 bg-hq-accent/10 px-3 py-2 text-sm text-hq-accent">
          {t("cityListDraftRestored")}
        </div>
      ) : null}
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
    </>
  );

  const reviewActions = (
    <div className="space-y-3 pt-2">
      {submitAttempted && hasDuplicateCoords ? (
        <p className="text-sm text-hq-danger">{t("cityListDuplicateCoords")}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="mr-auto rounded border border-hq-border px-3 py-2 text-sm text-hq-fg-muted hover:border-hq-danger hover:text-hq-danger"
          onClick={() => setResetConfirmOpen(true)}
          disabled={importing}
        >
          {t("cityListReset")}
        </button>
        <button
          type="button"
          className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
          onClick={() => {
            setStep("upload");
            setReviewIndex(0);
            setSubmitAttempted(false);
          }}
          disabled={importing}
        >
          {t("actions.cancel")}
        </button>
        <button
          type="submit"
          className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={importing || rows.length === 0}
        >
          {importing ? t("actions.saving") : t("cityListConfirmImport")}
        </button>
      </div>
    </div>
  );

  const desktopPreviewPane =
    screenshots.length > 0 ? (
      <div
        className={cn(
          "hidden min-w-0 flex-col items-center justify-start gap-3 md:flex",
          "md:w-[min(42%,22rem)] md:shrink-0 md:self-stretch",
        )}
      >
        <button
          type="button"
          className="block w-full overflow-hidden rounded-lg border border-hq-border bg-black"
          onClick={() => openPreview(previewIndex)}
          aria-label={t("cityListThumbnailPreview")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshots[previewIndex]!.previewUrl}
            alt=""
            className="mx-auto h-auto max-h-[min(78vh,42rem)] w-auto max-w-full object-contain"
          />
        </button>
        {screenshots.length > 1 ? (
          <ul className="flex w-full flex-wrap gap-2">
            {screenshots.map((shot, index) => (
              <li key={shot.id} className="w-14 shrink-0">
                <button
                  type="button"
                  className={cn(
                    "block w-full overflow-hidden rounded border bg-hq-canvas",
                    index === previewIndex
                      ? "border-hq-accent"
                      : "border-hq-border hover:border-hq-fg-muted",
                  )}
                  onClick={() => openPreview(index)}
                  aria-label={t("cityListThumbnailPreview")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.previewUrl}
                    alt=""
                    className="aspect-[3/4] w-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("cityListImportTitle")}
      ignoreOutsideDismiss={resetConfirmOpen}
      className={cn(
        "w-full max-w-[min(96vw,52rem)]",
        step === "review" &&
          screenshots.length > 0 &&
          "md:max-h-[min(90vh,820px)] md:max-w-5xl md:overflow-hidden",
      )}
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
            className={cn(
              "min-w-0 gap-5",
              screenshots.length > 0
                ? "flex flex-col md:flex-row md:items-stretch md:min-h-[min(70vh,36rem)]"
                : "space-y-4",
            )}
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void commit();
            }}
          >
            {desktopPreviewPane}

            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-4",
                screenshots.length > 0 && "md:min-h-0 md:overflow-y-auto",
              )}
            >
              {reviewMeta}

              {/* Mobile: card stepper */}
              <div className="space-y-3 md:hidden">
                {rows.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-hq-fg">
                          {t("cityListReviewBankProgress", {
                            current: reviewIndex + 1,
                            total: rows.length,
                          })}
                        </p>
                        {screenshots.length > 0 ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded border border-hq-border px-2.5 py-1.5 text-xs text-hq-fg hover:border-hq-accent"
                            onClick={() => openPreview(0)}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                            {t("cityListPreviewScreenshots")}
                          </button>
                        ) : null}
                      </div>
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-hq-border"
                        role="progressbar"
                        aria-valuemin={1}
                        aria-valuemax={rows.length}
                        aria-valuenow={reviewIndex + 1}
                        aria-label={t("cityListReviewBankProgress", {
                          current: reviewIndex + 1,
                          total: rows.length,
                        })}
                      >
                        <div
                          className="h-full rounded-full bg-hq-accent transition-[width] duration-200"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>

                    {activeRow ? (
                      <div className="space-y-3 rounded-xl border border-hq-border bg-hq-canvas p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                            {t("coords", {
                              server: activeRow.gameServerNumber,
                              x: activeRow.coordX,
                              y: activeRow.coordY,
                            })}
                          </p>
                          <button
                            type="button"
                            aria-label={t("actions.delete")}
                            className="rounded border border-hq-border p-1.5 text-hq-fg-muted hover:border-hq-danger hover:text-hq-danger"
                            onClick={() => removeRow(activeRow.rowKey)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                        <BankReviewCardFields
                          row={activeRow}
                          labels={fieldLabels}
                          errors={rowValidationErrors.get(activeRow.rowKey) ?? {}}
                          showErrors={(field) =>
                            showFieldError(activeRow.rowKey, field)
                          }
                          onTouchField={(field) =>
                            touchField(activeRow.rowKey, field)
                          }
                          onChange={(patch) =>
                            updateRow(activeRow.rowKey, patch)
                          }
                        />
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-hq-border px-3 py-2 text-sm text-hq-fg disabled:opacity-40"
                        onClick={() =>
                          setReviewIndex((prev) => Math.max(0, prev - 1))
                        }
                        disabled={reviewIndex <= 0}
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden />
                        {t("cityListPreviousBank")}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded border border-dashed border-hq-border px-3 py-2 text-sm text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
                        onClick={() => addRow()}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        {t("cityListAddRow")}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-hq-border px-3 py-2 text-sm text-hq-fg disabled:opacity-40"
                        onClick={() =>
                          setReviewIndex((prev) =>
                            Math.min(rows.length - 1, prev + 1),
                          )
                        }
                        disabled={reviewIndex >= rows.length - 1}
                      >
                        {t("cityListNextBank")}
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-hq-fg-muted">{t("emptyBanks")}</p>
                )}
              </div>

              {/* Desktop: row-based table */}
              <div className="hidden overflow-x-auto rounded-lg border border-hq-border md:block">
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
                    {rows.map((row) => {
                      const errs = rowValidationErrors.get(row.rowKey) ?? {};
                      const inputOk =
                        "w-16 min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1";
                      const inputErr =
                        "w-16 min-w-0 rounded border border-hq-danger bg-hq-canvas px-2 py-1";
                      return (
                        <tr
                          key={row.rowKey}
                          className="border-t border-hq-border"
                        >
                          <td className="px-3 py-2">
                            <div className="space-y-0.5">
                              <input
                                type="number"
                                min={1}
                                step={1}
                                className={
                                  showFieldError(row.rowKey, "level") &&
                                  errs.level
                                    ? inputErr
                                    : inputOk
                                }
                                value={row.level}
                                onChange={(event) =>
                                  updateRow(row.rowKey, {
                                    level: Number(event.target.value) || 0,
                                  })
                                }
                                onBlur={() =>
                                  touchField(row.rowKey, "level")
                                }
                              />
                              {showFieldError(row.rowKey, "level") &&
                              errs.level ? (
                                <p className="text-[11px] text-hq-danger">
                                  {errs.level}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="space-y-0.5">
                              <input
                                type="number"
                                min={1}
                                step={1}
                                className={cn(
                                  "w-20",
                                  showFieldError(
                                    row.rowKey,
                                    "gameServerNumber",
                                  ) && errs.gameServerNumber
                                    ? "min-w-0 rounded border border-hq-danger bg-hq-canvas px-2 py-1"
                                    : "min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1",
                                )}
                                value={row.gameServerNumber}
                                onChange={(event) =>
                                  updateRow(row.rowKey, {
                                    gameServerNumber:
                                      Number(event.target.value) || 0,
                                  })
                                }
                                onBlur={() =>
                                  touchField(row.rowKey, "gameServerNumber")
                                }
                              />
                              {showFieldError(
                                row.rowKey,
                                "gameServerNumber",
                              ) && errs.gameServerNumber ? (
                                <p className="text-[11px] text-hq-danger">
                                  {errs.gameServerNumber}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="space-y-0.5">
                              <input
                                type="number"
                                step={1}
                                className={cn(
                                  "w-20",
                                  showFieldError(row.rowKey, "coordX") &&
                                    errs.coordX
                                    ? "min-w-0 rounded border border-hq-danger bg-hq-canvas px-2 py-1"
                                    : "min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1",
                                )}
                                value={row.coordX}
                                onChange={(event) =>
                                  updateRow(row.rowKey, {
                                    coordX: Number(event.target.value) || 0,
                                  })
                                }
                                onBlur={() =>
                                  touchField(row.rowKey, "coordX")
                                }
                              />
                              {showFieldError(row.rowKey, "coordX") &&
                              errs.coordX ? (
                                <p className="text-[11px] text-hq-danger">
                                  {errs.coordX}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="space-y-0.5">
                              <input
                                type="number"
                                step={1}
                                className={cn(
                                  "w-20",
                                  showFieldError(row.rowKey, "coordY") &&
                                    errs.coordY
                                    ? "min-w-0 rounded border border-hq-danger bg-hq-canvas px-2 py-1"
                                    : "min-w-0 rounded border border-hq-border bg-hq-canvas px-2 py-1",
                                )}
                                value={row.coordY}
                                onChange={(event) =>
                                  updateRow(row.rowKey, {
                                    coordY: Number(event.target.value) || 0,
                                  })
                                }
                                onBlur={() =>
                                  touchField(row.rowKey, "coordY")
                                }
                              />
                              {showFieldError(row.rowKey, "coordY") &&
                              errs.coordY ? (
                                <p className="text-[11px] text-hq-danger">
                                  {errs.coordY}
                                </p>
                              ) : null}
                            </div>
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
                              max={bankDepositCapacity(row.level)}
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded border border-dashed border-hq-border px-3 py-2 text-sm text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
                onClick={() => addRow()}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("cityListAddRow")}
              </button>

              {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

              {reviewActions}
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

      <CityListImportResetDialog
        open={resetConfirmOpen}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={() => {
          setResetConfirmOpen(false);
          resetAndClearDraft();
        }}
      />
    </Dialog>
  );
}
