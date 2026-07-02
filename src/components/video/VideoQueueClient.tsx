"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import type { AllianceQueueJob } from "@/lib/video/video-queue.shared";
import {
  isInFlightProcessingStatus,
  videoJobLifecycleStage,
} from "@/lib/video/video-lifecycle.shared";

type Props = {
  initialJobs: AllianceQueueJob[];
  canProcess: boolean;
  ashedConnected: boolean;
  /** Whether env config requires Ashed when alliance override is off. */
  envRequiresAshed: boolean;
  initialHqOcrOnly: boolean;
  connectUrl: string;
};

export function VideoQueueClient({
  initialJobs,
  canProcess,
  ashedConnected,
  envRequiresAshed,
  initialHqOcrOnly,
  connectUrl,
}: Props) {
  const t = useTranslations("videoQueue");
  const tStatus = useTranslations("videoUpload.status");
  const tUpload = useTranslations("videoUpload");
  const tReview = useTranslations("videoReview");
  const tAdminJobs = useTranslations("admin.videoJobsPage");
  const router = useRouter();
  const [jobs, setJobs] = useState<AllianceQueueJob[]>(initialJobs);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hqOcrOnly, setHqOcrOnly] = useState(initialHqOcrOnly);
  const [ocrSettingsBusy, setOcrSettingsBusy] = useState(false);
  const [ocrSettingsError, setOcrSettingsError] = useState<string | null>(null);

  const ashedRequired = !hqOcrOnly && envRequiresAshed;

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tools/video-upload/queue");
    if (!res.ok) return;
    const data = (await res.json()) as {
      jobs: AllianceQueueJob[];
      hqOcrOnly?: boolean;
    };
    setJobs(data.jobs);
    if (typeof data.hqOcrOnly === "boolean") {
      setHqOcrOnly(data.hqOcrOnly);
    }
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const goConnect = useCallback(() => {
    router.push(connectUrl);
  }, [router, connectUrl]);

  const goReview = useCallback(
    (jobId: string) => {
      router.push(`/tools/video-upload/${jobId}/review`);
    },
    [router],
  );

  async function toggleHqOcrOnly(next: boolean) {
    setOcrSettingsBusy(true);
    setOcrSettingsError(null);
    try {
      const res = await fetch("/api/tools/video-upload/queue/ocr-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hqOcrOnly: next }),
      });
      const data = (await res.json()) as {
        hqOcrOnly?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? t("ocrSettingsSaveFailed"));
      }
      setHqOcrOnly(Boolean(data.hqOcrOnly));
    } catch (err) {
      setOcrSettingsError(
        err instanceof Error ? err.message : t("ocrSettingsSaveFailed"),
      );
    } finally {
      setOcrSettingsBusy(false);
    }
  }

  async function approve(jobId: string) {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; code?: string };
        if (data.code === "ashed_not_connected") {
          goConnect();
          return;
        }
        throw new Error(data.error ?? t("approveFailed"));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("approveFailed"));
    } finally {
      setActingJobId(null);
    }
  }

  async function reject(jobId: string) {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? t("rejectFailed"));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rejectFailed"));
    } finally {
      setActingJobId(null);
    }
  }

  async function discard(jobId: string) {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/discard`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? t("rejectFailed"));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rejectFailed"));
    } finally {
      setActingJobId(null);
    }
  }

  async function reprocess(jobId: string) {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/reprocess`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as {
          error?: string;
          code?: string;
        };
        if (data.code === "ashed_not_connected") {
          goConnect();
          return;
        }
        throw new Error(data.error ?? tAdminJobs("actionFailed"));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : tAdminJobs("actionFailed"));
    } finally {
      setActingJobId(null);
    }
  }

  const showConnectBanner = canProcess && ashedRequired && !ashedConnected;

  function statusLabel(status: string): string {
    const knownStatuses = [
      "pending_upload",
      "queued",
      "extracting",
      "parsing",
      "review",
      "submitting",
      "complete",
      "failed",
      "pending",
      "pending_approval",
      "processing",
    ] as const;
    if ((knownStatuses as readonly string[]).includes(status)) {
      return tStatus(status as (typeof knownStatuses)[number]);
    }
    return status;
  }

  function progressDetail(job: AllianceQueueJob): string | null {
    if (job.status === "pending_upload") {
      if (job.uploadedFrameCount != null && job.frameCount != null) {
        return `${job.uploadedFrameCount}/${job.frameCount}`;
      }
      return null;
    }
    if (isInFlightProcessingStatus(job.status)) {
      if (job.frameCount != null && job.uploadedFrameCount != null) {
        return `${job.uploadedFrameCount}/${job.frameCount}`;
      }
      return null;
    }
    if (job.status === "failed" && job.errorMessage) {
      return job.errorMessage;
    }
    return null;
  }

  const emptyMessage = tAdminJobs("empty");

  return (
    <div className="min-w-0 space-y-3">
      {canProcess ? (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <h2 className="text-sm font-semibold text-[#e6edf3]">
            {t("ocrSettingsTitle")}
          </h2>
          <p className="mt-1 text-sm text-[#8b949e]">{t("ocrSettingsDescription")}</p>
          <div className="mt-3 space-y-2">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={hqOcrOnly}
                disabled={ocrSettingsBusy}
                onChange={(e) => void toggleHqOcrOnly(e.target.checked)}
              />
              <span className="min-w-0 text-sm text-[#e6edf3]">
                {t("hqOcrOnlyLabel")}
              </span>
            </label>
            <p className="text-xs text-[#8b949e]">{t("hqOcrOnlyHint")}</p>
          </div>
          {ocrSettingsError ? (
            <p className="mt-2 text-sm text-red-400">{ocrSettingsError}</p>
          ) : null}
        </section>
      ) : null}

      {showConnectBanner ? (
        <div className="flex flex-col gap-2 rounded-xl border border-[#d29922] bg-[#d2992210] p-3 text-sm text-[#e6edf3] sm:flex-row sm:items-center sm:justify-between">
          <span>{t("connectBanner")}</span>
          <button
            type="button"
            onClick={goConnect}
            className="shrink-0 rounded-lg border border-[#d29922] px-3 py-1.5 text-sm font-medium text-[#d29922] hover:bg-[#d2992220]"
          >
            {t("connectCta")}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <ResponsiveRecordViews
        isEmpty={jobs.length === 0}
        emptyMessage={emptyMessage}
        mobileCards={jobs.map((job) => (
          <RecordDetailCard key={job.id}>
            <RecordDetailField label={t("table.time")}>
              <FormattedDateTime value={job.createdAt} />
            </RecordDetailField>
            <RecordDetailField label={tAdminJobs("statusFilter")}>
              <StatusBadge status={job.status} label={statusLabel(job.status)} />
              {progressDetail(job) ? (
                <p className="mt-1 text-xs text-[#8b949e]">{progressDetail(job)}</p>
              ) : null}
            </RecordDetailField>
            <RecordDetailField label={t("table.uploadedBy")}>
              {job.enqueuedBy ?? "—"}
            </RecordDetailField>
            <RecordDetailField label={t("table.target")}>
              {job.scoreTarget ?? "—"}
            </RecordDetailField>
            <RecordDetailField label={t("table.file")}>
              <span className="wrap-break-word">{job.fileName ?? job.id}</span>
            </RecordDetailField>
            <RecordDetailField label={t("table.actions")}>
              <JobActions
                job={job}
                acting={actingJobId === job.id}
                canProcess={canProcess}
                canApproveDirectly={!ashedRequired || ashedConnected}
                onApprove={() => void approve(job.id)}
                onReject={() => void reject(job.id)}
                onDiscard={() => void discard(job.id)}
                onReprocess={() => void reprocess(job.id)}
                onReview={() => goReview(job.id)}
                onConnect={goConnect}
                t={t}
                tUpload={tUpload}
                tReview={tReview}
              />
            </RecordDetailField>
          </RecordDetailCard>
        ))}
        desktopTable={
          <div className="overflow-x-auto rounded-xl border border-[#30363d]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#161b22] text-[#8b949e]">
                <tr>
                  <th className="px-4 py-2">{t("table.time")}</th>
                  <th className="px-4 py-2">{tAdminJobs("statusFilter")}</th>
                  <th className="px-4 py-2">{t("table.uploadedBy")}</th>
                  <th className="px-4 py-2">{t("table.target")}</th>
                  <th className="px-4 py-2">{t("table.file")}</th>
                  <th className="px-4 py-2">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-[#30363d]">
                    <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                      <FormattedDateTime value={job.createdAt} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge
                        status={job.status}
                        label={statusLabel(job.status)}
                      />
                      {progressDetail(job) ? (
                        <p className="mt-1 max-w-xs truncate text-xs text-[#8b949e]">
                          {progressDetail(job)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">{job.enqueuedBy ?? "—"}</td>
                    <td className="px-4 py-2">{job.scoreTarget ?? "—"}</td>
                    <td className="max-w-xs truncate px-4 py-2">
                      {job.fileName ?? job.id}
                    </td>
                    <td className="px-4 py-2">
                      <JobActions
                        job={job}
                        acting={actingJobId === job.id}
                        canProcess={canProcess}
                        canApproveDirectly={!ashedRequired || ashedConnected}
                        onApprove={() => void approve(job.id)}
                        onReject={() => void reject(job.id)}
                        onDiscard={() => void discard(job.id)}
                        onReprocess={() => void reprocess(job.id)}
                        onReview={() => goReview(job.id)}
                        onConnect={goConnect}
                        t={t}
                        tUpload={tUpload}
                        tReview={tReview}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const stage = videoJobLifecycleStage(status);
  const tone =
    stage === "needs_attention" || stage === "needs_upload"
      ? "border-[#f85149] text-[#f85149]"
      : stage === "ready_to_review"
        ? "border-[#3fb950] text-[#3fb950]"
        : stage === "processing" || stage === "submitting"
          ? "border-[#d29922] text-[#d29922]"
          : "border-[#8b949e] text-[#8b949e]";

  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {label}
    </span>
  );
}

function JobActions({
  job,
  acting,
  canProcess,
  canApproveDirectly,
  onApprove,
  onReject,
  onDiscard,
  onReprocess,
  onReview,
  onConnect,
  t,
  tUpload,
  tReview,
}: {
  job: AllianceQueueJob;
  acting: boolean;
  canProcess: boolean;
  canApproveDirectly: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDiscard: () => void;
  onReprocess: () => void;
  onReview: () => void;
  onConnect: () => void;
  t: ReturnType<typeof useTranslations>;
  tUpload: ReturnType<typeof useTranslations>;
  tReview: ReturnType<typeof useTranslations>;
}) {
  const stage = videoJobLifecycleStage(job.status);

  if (stage === "needs_upload") {
    return (
      <Link
        href="/tools/video-upload"
        className="rounded-md border border-[#30363d] px-2.5 py-1 text-xs text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff]"
      >
        {tUpload("viewAllUploads")}
      </Link>
    );
  }

  if (stage === "needs_approval" && canProcess) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
        {canApproveDirectly ? (
          <button
            type="button"
            disabled={acting}
            onClick={onApprove}
            className="rounded-md border border-[#3fb950] px-2.5 py-1 text-xs font-medium text-[#3fb950] hover:bg-[#3fb95020] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("approve")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-md border border-[#d29922] px-2.5 py-1 text-xs font-medium text-[#d29922] hover:bg-[#d2992220]"
          >
            {t("connectCta")}
          </button>
        )}
        <button
          type="button"
          disabled={acting}
          onClick={onReject}
          className="rounded-md border border-[#30363d] px-2.5 py-1 text-xs text-[#8b949e] hover:border-[#f85149] hover:text-[#f85149] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("reject")}
        </button>
      </div>
    );
  }

  if (stage === "processing" || stage === "submitting") {
    return (
      <button
        type="button"
        onClick={onReview}
        className="rounded-md border border-[#30363d] px-2.5 py-1 text-xs text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff]"
      >
        {tUpload("reviewLink")}
      </button>
    );
  }

  if (stage === "ready_to_review") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
        <button
          type="button"
          onClick={onReview}
          className="rounded-md border border-[#3fb950] px-2.5 py-1 text-xs font-medium text-[#3fb950] hover:bg-[#3fb95020]"
        >
          {tUpload("reviewLink")}
        </button>
        <button
          type="button"
          disabled={acting}
          onClick={onDiscard}
          className="rounded-md border border-[#30363d] px-2.5 py-1 text-xs text-[#8b949e] hover:border-[#f85149] hover:text-[#f85149] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tReview("discardResults")}
        </button>
      </div>
    );
  }

  if (stage === "needs_attention") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
        {canProcess ? (
          canApproveDirectly ? (
            <button
              type="button"
              disabled={acting}
              onClick={onReprocess}
              className="rounded-md border border-[#d29922] px-2.5 py-1 text-xs font-medium text-[#d29922] hover:bg-[#d2992220] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tReview("reprocess")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              className="rounded-md border border-[#d29922] px-2.5 py-1 text-xs font-medium text-[#d29922] hover:bg-[#d2992220]"
            >
              {t("connectCta")}
            </button>
          )
        ) : null}
        <button
          type="button"
          disabled={acting}
          onClick={onDiscard}
          className="rounded-md border border-[#30363d] px-2.5 py-1 text-xs text-[#8b949e] hover:border-[#f85149] hover:text-[#f85149] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tReview("discardResults")}
        </button>
      </div>
    );
  }

  return null;
}
