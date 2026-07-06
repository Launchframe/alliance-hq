"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import type { VideoJobInspectReport } from "@/lib/video/video-job-inspect.shared";

type Props = {
  jobId: string;
};

const HINT_STYLES = {
  info: "border-[#58a6ff40] bg-[#58a6ff10] text-[#79c0ff]",
  warning: "border-[#d2992240] bg-[#d2992210] text-[#e3b341]",
  error: "border-[#f8514940] bg-[#f8514910] text-[#ff7b72]",
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
  loadFailedMessage: string,
): Promise<VideoJobInspectReport> {
  const res = await fetch(`/api/admin/video-jobs/${jobId}/inspect`);
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

export function VideoJobDiagnosticsPanel({ jobId }: Props) {
  const t = useTranslations("admin.videoJobDetailPage");
  const [report, setReport] = useState<VideoJobInspectReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadFailedMessage = t("diagnosticsLoadFailed");

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchInspectReport(jobId, loadFailedMessage)
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
  }, [jobId, loadFailedMessage]);

  useEffect(() => {
    let cancelled = false;

    void fetchInspectReport(jobId, loadFailedMessage)
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
  }, [jobId, loadFailedMessage]);

  if (loading && !report) {
    return <p className="text-sm text-[#8b949e]">{t("diagnosticsLoading")}</p>;
  }

  if (error && !report) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#e6edf3] hover:bg-[#21262d]"
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
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8b949e]">
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

      <div className="grid gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-[#8b949e]">{t("diagnosticsOcrEngine")}</p>
          <p className="font-mono text-xs">{report.ocrEngineHint}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{t("diagnosticsAlliance")}</p>
          <p>{formatAllianceLabel(report.alliance)}</p>
          {report.alliance ? (
            <p className="text-xs text-[#8b949e]">
              {report.alliance.operatingMode}
              {report.alliance.videoHqOcrOnly ? " · HQ OCR only" : ""}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">
            {t("diagnosticsUploadedFrameCount")}
          </p>
          <p>
            {report.job.uploadedFrameCount ?? 0} /{" "}
            {report.job.frameCount ?? report.frameSummary.count}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">
            {t("diagnosticsOcrEntries")}
          </p>
          <p>{report.frameSummary.totalOcrEntries}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">
            {t("diagnosticsParsedRows")}
          </p>
          <p>{report.parsedRowsInDb}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">
            {t("diagnosticsSameSession")}
          </p>
          <p>
            {report.uploaderVsProcessorSameSession
              ? t("diagnosticsYes")
              : t("diagnosticsNo")}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{t("diagnosticsApprovedAt")}</p>
          <p>
            {report.job.approvedAt ? (
              <FormattedDateTime value={report.job.approvedAt} />
            ) : (
              "—"
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{t("diagnosticsUpdatedAt")}</p>
          <p>
            <FormattedDateTime value={report.job.updatedAt} />
          </p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">
            {t("diagnosticsFramesWithErrors")}
          </p>
          <p>{report.frameSummary.framesWithErrors}</p>
        </div>
      </div>

      <CopyToClipboardField
        label={t("diagnosticsJsonTitle")}
        value={json}
      />

      <pre className="max-h-[32rem] overflow-auto rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-xs text-[#c9d1d9]">
        {json}
      </pre>
    </div>
  );
}
