"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ScreenshotBboxOverlay } from "@/components/admin/ScreenshotBboxOverlay";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import {
  SCREENSHOT_OCR_FAILURE_LABELS,
  type ScreenshotOcrJobDetailReport,
  formatScreenshotOcrSource,
} from "@/lib/admin/screenshot-ocr-jobs.shared";
import {
  remapOverlayToModalLocal,
} from "@/lib/ocr/screenshot-ocr-geometry.shared";

type Props = {
  jobId: string;
  apiBase?: string;
};

const DEFAULT_API_BASE = "/api/admin/screenshot-jobs";

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "border-hq-green/40 bg-[#3fb95010]"
      : tone === "bad"
        ? "border-hq-danger/40 bg-[#f8514910]"
        : tone === "warn"
          ? "border-hq-warning/40 bg-[#d2992210]"
          : "border-hq-border bg-hq-surface";

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-hq-fg-muted">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-hq-fg">{value}</div>
    </div>
  );
}

async function fetchDetailReport(
  jobId: string,
  apiBase: string,
  loadFailedMessage: string,
): Promise<ScreenshotOcrJobDetailReport> {
  const res = await fetch(`${apiBase}/${jobId}`);
  const body = (await res.json()) as ScreenshotOcrJobDetailReport & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? loadFailedMessage);
  }
  if (!body.job) {
    throw new Error(loadFailedMessage);
  }
  return body;
}

export function ScreenshotOcrInspectorPanel({
  jobId,
  apiBase = DEFAULT_API_BASE,
}: Props) {
  const t = useTranslations("admin.screenshotJobsPage");
  const [report, setReport] = useState<ScreenshotOcrJobDetailReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadFailedMessage = t("loadFailed");

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchDetailReport(jobId, apiBase, loadFailedMessage)
      .then(setReport)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : loadFailedMessage);
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [jobId, apiBase, loadFailedMessage]);

  useEffect(() => {
    let cancelled = false;
    void fetchDetailReport(jobId, apiBase, loadFailedMessage)
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : loadFailedMessage);
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, apiBase, loadFailedMessage]);

  const job = report?.job;
  const modalOverlay = job?.bboxOverlays.find(
    (overlay) => overlay.fieldKey === "MODAL",
  );
  const modalWidth = modalOverlay
    ? Math.round(modalOverlay.rect.x1 - modalOverlay.rect.x0)
    : job?.sourceWidth ?? 1;
  const modalHeight = modalOverlay
    ? Math.round(modalOverlay.rect.y1 - modalOverlay.rect.y0)
    : job?.sourceHeight ?? 1;

  const modalOverlays = useMemo(() => {
    if (!job?.bboxOverlays.length || !modalOverlay) {
      return job?.bboxOverlays ?? [];
    }
    const modalCrop = {
      left: modalOverlay.rect.x0,
      top: modalOverlay.rect.y0,
      width: modalWidth,
      height: modalHeight,
    };
    return job.bboxOverlays
      .filter((overlay) => overlay.fieldKey !== "MODAL")
      .map((overlay) => remapOverlayToModalLocal(overlay, modalCrop));
  }, [job, modalOverlay, modalWidth, modalHeight]);

  if (loading && !report) {
    return <p className="text-sm text-hq-fg-muted">{t("loading")}</p>;
  }

  if (error && !report) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="text-sm text-hq-accent hover:underline"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (!job) return null;

  const quality = job.quality;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("detailTitle")}</h2>
          <p className="mt-1 text-sm text-hq-fg-muted">
            {formatScreenshotOcrSource(job.source)}
            {job.createdAt ? (
              <>
                {" · "}
                <FormattedDateTime value={job.createdAt} />
              </>
            ) : null}
          </p>
        </div>
        <CopyToClipboardField label={t("jobId")} value={job.id} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t("parsedOk")}
          value={job.parsedOk ? t("yes") : t("no")}
          tone={job.parsedOk ? "good" : "bad"}
        />
        <MetricCard
          label={t("complete")}
          value={job.complete ? t("yes") : t("no")}
          tone={job.complete ? "good" : "warn"}
        />
        <MetricCard
          label={t("pairedCount")}
          value={`${job.pairedCount} / ${job.expectedPairCount}`}
          tone={job.pairedCount >= 4 ? "good" : "warn"}
        />
        <MetricCard
          label={t("headerTotal")}
          value={formatNumber(job.headerTotal)}
        />
        <MetricCard
          label={t("componentSum")}
          value={formatNumber(quality.componentSum)}
        />
        <MetricCard
          label={t("sumDelta")}
          value={formatNumber(quality.sumDelta)}
          tone={
            quality.sumDelta != null && quality.sumDelta > 1 ? "bad" : "default"
          }
        />
        <MetricCard
          label={t("totalTime")}
          value={formatMs(quality.phaseTimings.totalMs)}
        />
        <MetricCard
          label={t("layoutClass")}
          value={quality.layoutClass}
        />
      </div>

      {job.failureCodes.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-hq-fg">{t("failureCodes")}</h3>
          <div className="flex flex-wrap gap-2">
            {job.failureCodes.map((code) => (
              <span
                key={code}
                className="rounded-full border border-hq-danger/40 bg-[#f8514910] px-2.5 py-1 text-xs text-hq-danger"
              >
                {SCREENSHOT_OCR_FAILURE_LABELS[code] ?? code}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <ScreenshotBboxOverlay
          title={t("fullPreview")}
          imageUrl={job.previews.full}
          width={job.sourceWidth}
          height={job.sourceHeight}
          overlays={job.bboxOverlays}
        />
        {job.previews.modal ? (
          <ScreenshotBboxOverlay
            title={t("modalPreview")}
            imageUrl={job.previews.modal}
            width={modalWidth}
            height={modalHeight}
            overlays={modalOverlays}
          />
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-hq-fg">{t("pairedRows")}</h3>
        <div className="overflow-x-auto rounded-xl border border-hq-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-hq-surface text-hq-fg-muted">
              <tr>
                <th className="px-3 py-2">{t("colKey")}</th>
                <th className="px-3 py-2">{t("colLabel")}</th>
                <th className="px-3 py-2">{t("colValueText")}</th>
                <th className="px-3 py-2">{t("colValue")}</th>
                <th className="px-3 py-2">{t("colYNorm")}</th>
              </tr>
            </thead>
            <tbody>
              {job.pairedRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-hq-fg-muted">
                    {t("pairedRowsEmpty")}
                  </td>
                </tr>
              ) : (
                job.pairedRows.map((row, index) => (
                  <tr key={`${row.key ?? "none"}-${index}`} className="border-t border-hq-border">
                    <td className="px-3 py-2 font-mono text-xs">{row.key ?? "—"}</td>
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.valueText}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatNumber(row.value)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.yNorm.toFixed(3)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-hq-fg">{t("diagnostics")}</h3>
        <pre className="max-h-[28rem] overflow-auto rounded-xl border border-hq-border bg-hq-canvas p-3 text-xs text-hq-fg">
          {JSON.stringify(job.diagnostics ?? quality, null, 2)}
        </pre>
      </div>
    </div>
  );
}
