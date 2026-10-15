"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import {
  coerceVsPerformanceRecordedDate,
  defaultVsPerformanceRecordedDate,
  listRecentVsPerformanceDates,
  type VsScorePeriod,
} from "@/lib/video/vs-recorded-date.shared";
import {
  detectVsSpreadsheetPeriodAndDate,
  VS_SPREADSHEET_MAX_BYTES,
} from "@/lib/vs-scores/spreadsheet-import.shared";

type Props = {
  open: boolean;
  onClose: () => void;
};

type DetectPreview = {
  period: VsScorePeriod;
  recordedDate: string;
};

export function VsSpreadsheetImportDialog({ open, onClose }: Props) {
  const t = useTranslations("vsPerformance.import");
  const locale = useLocale();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [period, setPeriod] = useState<VsScorePeriod>("weekly");
  const [recordedDate, setRecordedDate] = useState(() =>
    defaultVsPerformanceRecordedDate("weekly"),
  );
  const [detected, setDetected] = useState<DetectPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateOptions = useMemo(
    () =>
      listRecentVsPerformanceDates({
        period,
        includeDate: recordedDate,
        daysBack: 56,
      }),
    [period, recordedDate],
  );

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(`${value}T00:00:00.000Z`)),
    [locale],
  );

  const reset = useCallback(() => {
    setFile(null);
    setDetected(null);
    setError(null);
    setBusy(false);
    setPeriod("weekly");
    setRecordedDate(defaultVsPerformanceRecordedDate("weekly"));
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose, reset]);

  const onPickFile = useCallback((next: File | null) => {
    setError(null);
    setDetected(null);
    if (!next) {
      setFile(null);
      return;
    }
    const lower = next.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx")) {
      setFile(null);
      setError(t("errors.unsupportedType"));
      return;
    }
    if (next.size > VS_SPREADSHEET_MAX_BYTES) {
      setFile(null);
      setError(t("errors.tooLarge"));
      return;
    }
    setFile(next);
    // Filename-only hint via the shared detector (Week of / Saturday→Sunday /
    // daily Mon–Sat). Server re-detects from sheet contents on upload.
    const hint = detectVsSpreadsheetPeriodAndDate({
      cells: [],
      fileName: next.name,
    });
    setPeriod(hint.period);
    setRecordedDate(hint.recordedDate);
    setDetected({
      period: hint.period,
      recordedDate: hint.recordedDate,
    });
  }, [t]);

  const submit = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("period", period);
      body.set("recordedDate", recordedDate);
      const res = await fetch("/api/vs-performance/spreadsheet-import", {
        method: "POST",
        body,
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        jobId?: string;
        period?: VsScorePeriod;
        recordedDate?: string;
      } | null;
      if (!res.ok || !data?.jobId) {
        setError(data?.error ?? t("errors.parseFailed"));
        return;
      }
      reset();
      onClose();
      router.push(`/tools/video-upload/${data.jobId}/review`);
    } catch {
      setError(t("errors.parseFailed"));
    } finally {
      setBusy(false);
    }
  }, [busy, file, onClose, period, recordedDate, reset, router, t]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vs-spreadsheet-import-title"
      data-testid="vs-spreadsheet-import-dialog"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-hq-border bg-hq-surface p-4 shadow-xl">
        <h2
          id="vs-spreadsheet-import-title"
          className="text-lg font-semibold text-hq-fg"
        >
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("help")}</p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void submit();
          }}
        >
          <label className="block text-xs text-hq-fg-muted">
            {t("fileLabel")}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-1 block w-full text-sm text-hq-fg"
              disabled={busy}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              data-testid="vs-spreadsheet-import-file"
            />
          </label>

          {detected ? (
            <p className="text-xs text-hq-fg-muted" data-testid="vs-spreadsheet-detected">
              {t("detectedWeek", { date: formatDate(detected.recordedDate) })}
            </p>
          ) : null}

          <label className="block text-xs text-hq-fg-muted">
            {t("period")}
            <select
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={period}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as VsScorePeriod;
                setPeriod(next);
                setRecordedDate((prev) =>
                  coerceVsPerformanceRecordedDate(prev, next),
                );
              }}
              data-testid="vs-spreadsheet-import-period"
            >
              <option value="weekly">{t("periodWeekly")}</option>
              <option value="daily">{t("periodDaily")}</option>
            </select>
          </label>

          <label className="block text-xs text-hq-fg-muted">
            {t("recordedDate")}
            <select
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={recordedDate}
              disabled={busy}
              onChange={(e) => setRecordedDate(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              data-testid="vs-spreadsheet-import-date"
            >
              {dateOptions.map((date) => (
                <option key={date} value={date}>
                  {period === "weekly"
                    ? t("weeklyDateOption", { date: formatDate(date) })
                    : formatDate(date)}
                </option>
              ))}
            </select>
          </label>

          {error ? (
            <p
              className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger"
              role="alert"
              data-testid="vs-spreadsheet-import-error"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy || !file}
              className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
              data-testid="vs-spreadsheet-import-submit"
            >
              {busy ? t("submitting") : t("submit")}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-border disabled:opacity-50"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
