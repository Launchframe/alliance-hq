"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, ImageIcon, Plus } from "lucide-react";

import { CityListBankReviewCard } from "@/components/banks/CityListBankReviewCard";
import { CityListImportResetDialog } from "@/components/banks/CityListImportResetDialog";
import { CityListScreenshotPreviewPane } from "@/components/banks/CityListScreenshotPreviewPane";
import { useCityListPreviewLayout } from "@/components/banks/useCityListPreviewLayout";
import { Link, useRouter } from "@/i18n/navigation";
import {
  clearCityListImportDraft,
  readCityListImportDraft,
  writeCityListImportDraft,
  type CityListImportDraftRow,
  type CityListImportDraftSnapshot,
} from "@/lib/banks/city-list-import-draft.shared";
import {
  cityListReviewRowsHaveErrors,
  classifyCityListImportRowsAgainstHq,
  defaultPlaceholderGameServerNumber,
  isCityListPlaceholderCoords,
  listExtraHqBanksForCityListImport,
  validateCityListReviewRow,
  type CityListRowErrors,
  type CityListRowFieldName,
} from "@/lib/banks/city-list-import-review.shared";
import {
  clearCityListImportScreenshotPreviews,
  getCityListImportScreenshotPreviews,
  type CityListImportScreenshotPreview,
} from "@/lib/banks/city-list-import-session.client";
import { formatCityListServerTime } from "@/lib/banks/city-list-server-time.shared";
import type {
  BankManagementPayload,
  BankWithSlips,
} from "@/lib/banks/types.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

type ReviewRow = CityListImportDraftRow;

type ImportCityListResponse = {
  dashboard?: BankManagementPayload;
  error?: string;
};

type Props = {
  allianceId: string;
  existingBanks: BankWithSlips[];
  canWrite: boolean;
};

function newRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

function touchKey(rowKey: string, field: CityListRowFieldName): string {
  return `${rowKey}:${field}`;
}

function bankKey(server: number, x: number, y: number): string {
  return `${server}:${x}:${y}`;
}

export function CityListImportReviewClient({
  allianceId,
  existingBanks,
  canWrite,
}: Props) {
  const t = useTranslations("bankManagement");
  const router = useRouter();

  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [snapshot, setSnapshot] = useState<CityListImportDraftSnapshot>(null);
  const [screenshots, setScreenshots] = useState<
    CityListImportScreenshotPreview[]
  >([]);
  const [screenshotIndex, setScreenshotIndex] = useState(0);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [archiveMissingBanks, setArchiveMissingBanks] = useState(false);
  const [matchedBanksOpen, setMatchedBanksOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const previewAutoOpenedRef = useRef(false);

  const {
    device: previewDevice,
    placement: previewPlacement,
    available: previewPlacements,
    open: previewOpen,
    sideWidthPx: previewSideWidthPx,
    dockHeightPx: previewDockHeightPx,
    setOpen: setPreviewOpen,
    setPlacement: setPreviewPlacement,
    setSideWidthPx: setPreviewSideWidthPx,
    setDockHeightPx: setPreviewDockHeightPx,
    getImageTransform,
    setImageTransform,
  } = useCityListPreviewLayout();

  const effectivePreviewPlacement =
    previewPlacement === "side" && previewDevice === "mobile"
      ? "bottom"
      : previewPlacement;

  const hasScreenshots = screenshots.length > 0;
  const clampedScreenshotIndex =
    screenshots.length === 0
      ? 0
      : Math.min(screenshotIndex, screenshots.length - 1);
  const activeScreenshot =
    screenshots[clampedScreenshotIndex] ?? screenshots[0];

  useEffect(() => {
    // Defer sessionStorage read past the first paint so SSR hydration matches
    // (draft is browser-only) without syncing setState inside the effect body.
    const timer = window.setTimeout(() => {
      const draft = readCityListImportDraft(allianceId);
      if (!draft) {
        setRows([]);
        setHydrated(true);
        return;
      }
      setRows(draft.rows);
      setSnapshot(draft.snapshot);
      setScreenshots(getCityListImportScreenshotPreviews());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [allianceId]);

  useEffect(() => {
    if (!hydrated || !rows || rows.length === 0) return;
    writeCityListImportDraft(allianceId, {
      version: 1,
      rows,
      snapshot,
    });
  }, [allianceId, hydrated, rows, snapshot]);

  useEffect(() => {
    if (!hydrated || !hasScreenshots || previewAutoOpenedRef.current) return;
    previewAutoOpenedRef.current = true;
    if (previewDevice === "desktop") {
      setPreviewOpen(true);
    }
  }, [hasScreenshots, hydrated, previewDevice, setPreviewOpen]);

  const requiredMsg = t("cityListValidationRequired");
  const levelMinMsg = t("cityListValidationLevelMin");

  const showFieldError = useCallback(
    (rowKey: string, field: CityListRowFieldName): boolean =>
      submitAttempted || touched.has(touchKey(rowKey, field)),
    [submitAttempted, touched],
  );

  const rowValidationErrors = useMemo(() => {
    if (!rows) return new Map<string, CityListRowErrors>();
    return new Map(
      rows.map((row) => [
        row.rowKey,
        validateCityListReviewRow(row, requiredMsg, levelMinMsg),
      ]),
    );
  }, [rows, requiredMsg, levelMinMsg]);

  const presence = useMemo(
    () =>
      classifyCityListImportRowsAgainstHq(rows ?? [], existingBanks),
    [rows, existingBanks],
  );

  const hasDuplicateCoords = useMemo(() => {
    if (!rows) return false;
    const seen = new Set<string>();
    for (const row of rows) {
      if (isCityListPlaceholderCoords(row.coordX, row.coordY)) continue;
      const key = bankKey(row.gameServerNumber, row.coordX, row.coordY);
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }, [rows]);

  const rowKeys = useMemo(
    () =>
      new Set(
        (rows ?? [])
          .filter((row) => !isCityListPlaceholderCoords(row.coordX, row.coordY))
          .map((row) =>
            bankKey(row.gameServerNumber, row.coordX, row.coordY),
          ),
      ),
    [rows],
  );

  const extraHqBankCount = useMemo(
    () =>
      listExtraHqBanksForCityListImport(existingBanks, rowKeys).length,
    [existingBanks, rowKeys],
  );

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    return rows.filter((row) => {
      if (isCityListPlaceholderCoords(row.coordX, row.coordY)) return true;
      if (!presence.rowExistsInHq(row)) return true;
      return matchedBanksOpen;
    });
  }, [rows, presence, matchedBanksOpen]);

  const showIncompleteWarning =
    snapshot?.capturedCount != null &&
    (rows?.filter((r) => !isCityListPlaceholderCoords(r.coordX, r.coordY))
      .length ?? 0) < snapshot.capturedCount;

  const isCompleteImport =
    snapshot?.capturedCount != null &&
    (rows?.filter((r) => !isCityListPlaceholderCoords(r.coordX, r.coordY))
      .length ?? 0) === snapshot.capturedCount;

  const showExtraHqWarning = isCompleteImport && extraHqBankCount > 0;
  const effectiveArchiveMissingBanks =
    showExtraHqWarning && archiveMissingBanks;

  const updateRow = useCallback((rowKey: string, patch: Partial<ReviewRow>) => {
    setRows((prev) =>
      prev
        ? prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row))
        : prev,
    );
  }, []);

  const removeRow = useCallback((rowKey: string) => {
    setRows((prev) => (prev ? prev.filter((row) => row.rowKey !== rowKey) : prev));
  }, []);

  const touchField = useCallback((rowKey: string, field: CityListRowFieldName) => {
    setTouched((prev) => {
      const key = touchKey(rowKey, field);
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    if (!rows) return;
    const defaultGameServerNumber = defaultPlaceholderGameServerNumber(
      rows.map((row) => row.gameServerNumber),
      existingBanks.map((bank) => bank.gameServerNumber),
    );
    setRows((prev) =>
      prev ? [...prev, buildPlaceholderRow(defaultGameServerNumber)] : prev,
    );
  }, [existingBanks, rows]);

  const leaveToBankManagement = useCallback(() => {
    router.push("/bank-management");
  }, [router]);

  const resetImport = useCallback(() => {
    clearCityListImportDraft(allianceId);
    clearCityListImportScreenshotPreviews();
    setRows([]);
    setSnapshot(null);
    setScreenshots([]);
    router.push("/bank-management");
  }, [allianceId, router]);

  const commit = useCallback(async () => {
    if (!rows || rows.length === 0 || importing || !canWrite) return;
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
          archiveMissingBanks: effectiveArchiveMissingBanks,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | ImportCityListResponse
        | null;
      if (!res.ok || !body?.dashboard) {
        throw new Error(body?.error ?? t("cityListParseFailed"));
      }
      clearCityListImportDraft(allianceId);
      clearCityListImportScreenshotPreviews();
      router.push("/bank-management");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cityListParseFailed"));
    } finally {
      setImporting(false);
    }
  }, [
    allianceId,
    canWrite,
    effectiveArchiveMissingBanks,
    hasDuplicateCoords,
    importing,
    levelMinMsg,
    requiredMsg,
    rows,
    router,
    snapshot,
    t,
  ]);

  if (!hydrated || rows == null) {
    return (
      <div className="mx-auto max-w-6xl p-4 text-sm text-hq-fg-muted">
        {t("actions.saving")}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-hq-fg">
          {t("cityListReviewPageTitle")}
        </h1>
        <p className="text-sm text-hq-fg-muted">{t("cityListReviewEmpty")}</p>
        <Link
          href="/bank-management"
          className="inline-flex w-fit rounded border border-hq-border px-3 py-2 text-sm text-hq-fg hover:border-hq-accent"
        >
          {t("cityListBackToBanks")}
        </Link>
      </div>
    );
  }

  const missingPadCount = rows.filter((r) =>
    isCityListPlaceholderCoords(r.coordX, r.coordY),
  ).length;

  const showSidePreview =
    hasScreenshots && previewOpen && effectivePreviewPlacement === "side";
  const showTopPreview =
    hasScreenshots && previewOpen && effectivePreviewPlacement === "top";
  const showBottomPreview =
    hasScreenshots && previewOpen && effectivePreviewPlacement === "bottom";

  const previewNode =
    hasScreenshots && previewOpen && activeScreenshot ? (
      <CityListScreenshotPreviewPane
        screenshots={screenshots}
        screenshotIndex={clampedScreenshotIndex}
        onScreenshotIndexChange={setScreenshotIndex}
        placement={effectivePreviewPlacement}
        available={previewPlacements}
        onPlacementChange={setPreviewPlacement}
        onClose={() => setPreviewOpen(false)}
        sideWidthPx={previewSideWidthPx}
        dockHeightPx={previewDockHeightPx}
        onSideWidthChange={setPreviewSideWidthPx}
        onDockHeightChange={setPreviewDockHeightPx}
        imageTransform={getImageTransform(activeScreenshot.id)}
        onImageTransformChange={(transform) =>
          setImageTransform(activeScreenshot.id, transform)
        }
      />
    ) : null;

  return (
    <div
      className={`relative flex min-w-0 w-full max-w-full overflow-x-clip ${
        showSidePreview ? "flex-row" : "flex-col"
      }`}
    >
      {showTopPreview ? previewNode : null}
      <div
        className={`mx-auto flex min-w-0 w-full max-w-6xl flex-1 flex-col gap-4 p-4 pb-28 ${
          showSidePreview ? "min-w-0" : ""
        }`}
        style={
          showBottomPreview
            ? { paddingBottom: previewDockHeightPx + 112 }
            : undefined
        }
      >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold text-hq-fg">
            {t("cityListReviewPageTitle")}
          </h1>
          <div className="flex flex-wrap gap-2 text-xs text-hq-fg-muted">
            <span className="rounded-full border border-hq-border px-2.5 py-1">
              {t("cityListNewBankCount", { count: presence.newCount })}
            </span>
            <span className="rounded-full border border-hq-border px-2.5 py-1">
              {t("cityListExistingBankCount", {
                count: presence.existingCount,
              })}
            </span>
            {missingPadCount > 0 ? (
              <span className="rounded-full border border-hq-warning/40 px-2.5 py-1 text-hq-warning">
                {t("cityListMissingFromImportCount", {
                  count: missingPadCount,
                })}
              </span>
            ) : null}
            {snapshot?.serverTime ? (
              <span className="rounded-full border border-hq-border px-2.5 py-1">
                {t("cityListServerTime", {
                  time: formatCityListServerTime(snapshot.serverTime),
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasScreenshots ? (
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded border px-3 py-2 text-sm ${
                previewOpen
                  ? "border-hq-accent bg-hq-accent/10 text-hq-accent"
                  : "border-hq-border text-hq-fg"
              }`}
              onClick={() => setPreviewOpen((open) => !open)}
            >
              <ImageIcon className="h-4 w-4" aria-hidden />
              {t("cityListPreviewScreenshots")}
            </button>
          ) : null}
          <Link
            href="/bank-management"
            className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
          >
            {t("cityListBackToBanks")}
          </Link>
        </div>
      </div>

      {showIncompleteWarning ? (
        <div className="rounded-lg border border-hq-warning/40 bg-hq-warning/10 px-3 py-2 text-sm text-hq-warning">
          {t("cityListIncompleteWarning")}
        </div>
      ) : null}
      {showExtraHqWarning ? (
        <div className="space-y-2 rounded-lg border border-hq-warning/40 bg-hq-warning/10 px-3 py-2 text-sm text-hq-warning">
          <p>{t("cityListExtraHqWarning")}</p>
          <label className="flex items-start gap-2 text-hq-fg">
            <input
              type="checkbox"
              className="mt-1"
              checked={archiveMissingBanks}
              onChange={(event) =>
                setArchiveMissingBanks(event.target.checked)
              }
            />
            <span>
              <span className="font-medium">
                {t("cityListArchiveMissingLabel", {
                  count: extraHqBankCount,
                })}
              </span>
              <span className="mt-0.5 block text-xs text-hq-fg-muted">
                {t("cityListArchiveMissingHint")}
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {presence.existingCount > 0 ? (
        <div className="rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-4 text-sm text-[#e3b341]">
          <p className="font-medium">
            {t("cityListExistingBanksClusterTitle", {
              count: presence.existingCount,
            })}
          </p>
          <p className="mt-1 text-hq-fg">{t("cityListExistingBanksClusterHint")}</p>
          <button
            type="button"
            onClick={() => setMatchedBanksOpen((open) => !open)}
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-hq-border px-2 py-1 text-xs text-hq-fg hover:bg-hq-canvas"
          >
            {matchedBanksOpen ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
            {matchedBanksOpen
              ? t("cityListExistingBanksClusterHide")
              : t("cityListExistingBanksClusterShow")}
          </button>
        </div>
      ) : null}

      <form
        className="min-w-0 space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void commit();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleRows.map((row) => {
            const isPlaceholder = isCityListPlaceholderCoords(
              row.coordX,
              row.coordY,
            );
            const statusLabel = isPlaceholder
              ? t("cityListRowMissing")
              : presence.rowExistsInHq(row)
                ? t("cityListRowExisting")
                : t("cityListRowNew");
            return (
              <CityListBankReviewCard
                key={row.rowKey}
                row={row}
                statusLabel={statusLabel}
                isPlaceholder={isPlaceholder}
                errors={rowValidationErrors.get(row.rowKey) ?? {}}
                showErrors={(field) => showFieldError(row.rowKey, field)}
                onTouchField={(field) => touchField(row.rowKey, field)}
                onChange={(patch) => updateRow(row.rowKey, patch)}
                onRemove={() => removeRow(row.rowKey)}
                deleteLabel={t("actions.delete")}
                amountInvalidMsg={t("cityListAmountKInvalid")}
              />
            );
          })}
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
        {submitAttempted && hasDuplicateCoords ? (
          <p className="text-sm text-hq-danger">{t("cityListDuplicateCoords")}</p>
        ) : null}

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hq-border bg-hq-surface/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
              onClick={leaveToBankManagement}
              disabled={importing}
            >
              {t("actions.cancel")}
            </button>
            <button
              type="button"
              className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg-muted"
              onClick={() => setResetDialogOpen(true)}
              disabled={importing}
            >
              {t("cityListReset")}
            </button>
            <button
              type="submit"
              className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={importing || !canWrite || rows.length === 0}
            >
              {importing ? t("actions.saving") : t("cityListConfirmImport")}
            </button>
          </div>
        </div>
      </form>

      <CityListImportResetDialog
        open={resetDialogOpen}
        onCancel={() => setResetDialogOpen(false)}
        onConfirm={() => {
          setResetDialogOpen(false);
          resetImport();
        }}
      />

      {hasScreenshots && !previewOpen ? (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="fixed bottom-28 right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-hq-accent bg-[#0c2d6b] text-hq-fg shadow-lg hover:bg-[#1a4480] sm:bottom-24"
          aria-label={t("cityListPreviewScreenshots")}
        >
          <ImageIcon className="h-5 w-5 shrink-0" aria-hidden />
        </button>
      ) : null}
      </div>
      {showSidePreview ? previewNode : null}
      {showBottomPreview ? previewNode : null}
    </div>
  );
}
