"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import type { VideoJobInspectReport } from "@/lib/video/video-job-inspect.shared";

type Props = {
  jobId: string;
  apiBase?: string;
};

const DEFAULT_API_BASE = "/api/admin/video-jobs";

const HINT_STYLES = {
  info: "border-hq-accent/40 bg-hq-accent/10 text-hq-accent",
  warning: "border-hq-warning/40 bg-hq-warning/10 text-hq-warning",
  error: "border-hq-danger/40 bg-hq-danger/10 text-hq-danger",
} as const;

function formatAllianceLabel(
  alliance: VideoJobInspectReport["alliance"],
): string {
  if (!alliance) return "—";
  const tag = alliance.tag?.trim();
  const name = alliance.name?.trim();
  if (tag && name) return `${tag} · ${name}`;
  return tag ?? name ?? "—";
}

async function fetchInspectReport(
  jobId: string,
  apiBase: string,
  loadFailedMessage: string,
): Promise<VideoJobInspectReport> {
  const res = await fetch(`${apiBase}/${jobId}/inspect`);
  const body = (await res.json()) as {
    report?: VideoJobInspectReport;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? loadFailedMessage);
  }
  if (!body.report) {
    throw new Error(loadFailedMessage);
  }
  return body.report;
}

export function VideoJobDiagnosticsPanel({
  jobId,
  apiBase = DEFAULT_API_BASE,
}: Props) {
  const t = useTranslations("admin.videoJobDetailPage");
  const [report, setReport] = useState<VideoJobInspectReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadFailedMessage = t("diagnosticsLoadFailed");

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchInspectReport(jobId, apiBase, loadFailedMessage)
      .then((next) => {
        setReport(next);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : loadFailedMessage);
        setReport(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [jobId, apiBase, loadFailedMessage]);

  useEffect(() => {
    let cancelled = false;

    void fetchInspectReport(jobId, apiBase, loadFailedMessage)
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

  if (loading && !report) {
    return <p className="text-sm text-hq-fg-muted">{t("diagnosticsLoading")}</p>;
  }

  if (error && !report) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-hq-danger">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted"
        >
          {t("diagnosticsRetry")}
        </button>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  const json = JSON.stringify(report, null, 2);

  return (
    <div className="space-y-4">
      {report.hints.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
            {t("diagnosticsHintsTitle")}
          </p>
          <ul className="space-y-2">
            {report.hints.map((hint) => (
              <li
                key={hint.code}
                className={`rounded-lg border px-3 py-2 text-sm ${HINT_STYLES[hint.severity]}`}
              >
                {t(`diagnosticsHints.${hint.code}`, hint.values ?? {})}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-xl border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-hq-fg-muted">{t("diagnosticsOcrEngine")}</p>
          <p className="font-mono text-xs">{report.ocrEngineHint}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{t("diagnosticsAlliance")}</p>
          <p>{formatAllianceLabel(report.alliance)}</p>
          {report.alliance ? (
            <p className="text-xs text-hq-fg-muted">
              {report.alliance.operatingMode}
              {report.alliance.videoHqOcrOnly ? " · HQ OCR only" : ""}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">
            {t("diagnosticsUploadedFrameCount")}
          </p>
          <p>
            {report.job.uploadedFrameCount ?? 0} /{" "}
            {report.job.frameCount ?? report.frameSummary.count}
          </p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">
            {t("diagnosticsOcrEntries")}
          </p>
          <p>{report.frameSummary.totalOcrEntries}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">
            {t("diagnosticsParsedRows")}
          </p>
          <p>{report.parsedRowsInDb}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">
            {t("diagnosticsSameSession")}
          </p>
          <p>
            {report.uploaderVsProcessorSameSession
              ? t("diagnosticsYes")
              : t("diagnosticsNo")}
          </p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{t("diagnosticsApprovedAt")}</p>
          <p>
            {report.job.approvedAt ? (
              <FormattedDateTime value={report.job.approvedAt} />
            ) : (
              "—"
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{t("diagnosticsUpdatedAt")}</p>
          <p>
            <FormattedDateTime value={report.job.updatedAt} />
          </p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">
            {t("diagnosticsFramesWithErrors")}
          </p>
          <p>{report.frameSummary.framesWithErrors}</p>
        </div>
      </div>

      <CopyToClipboardField
        label={t("diagnosticsJsonTitle")}
        value={json}
      />

      <pre className="max-h-[32rem] overflow-auto rounded-xl border border-hq-border bg-hq-canvas p-3 text-xs text-hq-fg">
        {json}
      </pre>
    </div>
  );
}
