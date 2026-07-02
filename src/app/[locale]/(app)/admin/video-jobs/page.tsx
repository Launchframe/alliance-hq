"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";

import { Link } from "@/i18n/navigation";

import {
  canReprocessVideoJob,
  canRequeueVideoJob,
} from "@/lib/video/admin-job-actions";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import type { QualityBucket } from "@/lib/video/quality-score";

type VideoJob = {
  id: string;
  status: string;
  fileName: string | null;
  scoreTarget: string | null;
  allianceId: string | null;
  errorMessage: string | null;
  frameCount: number | null;
  timingsJson: VideoProcessTimings | Record<string, unknown> | null;
  qualityBucket: QualityBucket | null;
  qualityScore: number | null;
  rating: string | null;
  ratingReason: string | null;
  passKey: string | null;
  groupId: string | null;
  createdAt: string;
};

const BUCKET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All buckets" },
  { value: "perfect", label: "perfect" },
  { value: "q1", label: "q1" },
  { value: "q2", label: "q2" },
  { value: "q3", label: "q3" },
  { value: "q4", label: "q4" },
  { value: "q5", label: "q5" },
  { value: "dropped_the_ball", label: "dropped_the_ball" },
];

const QUALITY_BUCKET_COLORS: Record<string, string> = {
  perfect: "bg-[#3fb95020] text-[#3fb950] border-[#3fb950]",
  q1: "bg-[#3fb95010] text-[#3fb950] border-[#3fb950]",
  q2: "bg-[#d2992210] text-[#d29922] border-[#d29922]",
  q3: "bg-[#d2992210] text-[#d29922] border-[#d29922]",
  q4: "bg-[#f8514910] text-[#f85149] border-[#f85149]",
  q5: "bg-[#f8514910] text-[#f85149] border-[#f85149]",
  dropped_the_ball: "bg-[#f8514920] text-[#f85149] border-[#f85149]",
};

function QualityBadge({ bucket }: { bucket: string | null | undefined }) {
  if (!bucket) return null;
  const cls =
    QUALITY_BUCKET_COLORS[bucket] ??
    "bg-[#21262d] text-[#8b949e] border-[#30363d]";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {bucket}
    </span>
  );
}

function formatJobDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function readTimings(
  raw: VideoJob["timingsJson"],
): VideoProcessTimings | null {
  if (!raw || typeof raw !== "object") return null;
  if ("totalMs" in raw && typeof raw.totalMs === "number") {
    return raw as VideoProcessTimings;
  }
  return null;
}

export default function AdminVideoJobsPage() {
  const t = useTranslations("admin");
  const tJobs = useTranslations("admin.videoJobsPage");
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [errorDialogJob, setErrorDialogJob] = useState<VideoJob | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>("");
  const [selectedRating, setSelectedRating] = useState<string>("");
  const [selectedPassKey, setSelectedPassKey] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("failed");

  const loadJobs = useCallback(
    async (bucket: string, rating: string, passKey: string, status: string) => {
      const params = new URLSearchParams({ limit: "200" });
      if (status === "all") {
        params.set("status", "all");
      } else if (status) {
        params.set("status", status);
      }
      if (bucket) params.set("bucket", bucket);
      if (rating) params.set("rating", rating);
      if (passKey) params.set("passKey", passKey);
      const res = await fetch(`/api/admin/video-jobs?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { jobs: VideoJob[] };
      setJobs(data.jobs);
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        await loadJobs(selectedBucket, selectedRating, selectedPassKey, selectedStatus);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [loadJobs, selectedBucket, selectedRating, selectedPassKey, selectedStatus, t]);

  // Derive available pass keys from loaded jobs for the filter dropdown
  const availablePassKeys = Array.from(
    new Set(jobs.map((j) => j.passKey).filter(Boolean) as string[]),
  ).sort();

  async function runAction(jobId: string, action: "requeue" | "reprocess") {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/video-jobs/${jobId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? tJobs("actionFailed"));
      }
      await loadJobs(selectedBucket, selectedRating, selectedPassKey, selectedStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : tJobs("actionFailed"));
    } finally {
      setActingJobId(null);
    }
  }

  if (error && jobs.length === 0) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="min-w-0 space-y-3">
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#8b949e]">{tJobs("statusFilter")}</label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-lg border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
          >
            <option value="failed">{tJobs("statusFailed")}</option>
            <option value="queued">{tJobs("statusQueued")}</option>
            <option value="processing">{tJobs("statusProcessing")}</option>
            <option value="review">{tJobs("statusReview")}</option>
            <option value="complete">{tJobs("statusComplete")}</option>
            <option value="all">{tJobs("allStatuses")}</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#8b949e]">{tJobs("bucketFilter")}</label>
          <select
            value={selectedBucket}
            onChange={(e) => setSelectedBucket(e.target.value)}
            className="rounded-lg border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
          >
            {BUCKET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#8b949e]">{tJobs("ratingFilter")}</label>
          <select
            value={selectedRating}
            onChange={(e) => setSelectedRating(e.target.value)}
            className="rounded-lg border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
          >
            <option value="">{tJobs("allRatings")}</option>
            <option value="up">👍</option>
            <option value="down">👎</option>
          </select>
        </div>
        {availablePassKeys.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8b949e]">{tJobs("passFilter")}</label>
            <select
              value={selectedPassKey}
              onChange={(e) => setSelectedPassKey(e.target.value)}
              className="rounded-lg border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs font-mono text-[#e6edf3]"
            >
              <option value="">{tJobs("allPasses")}</option>
              {availablePassKeys.map((pk) => (
                <option key={pk} value={pk}>{pk}</option>
              ))}
            </select>
          </div>
        )}
        <Link
          href="/admin/video-jobs/analytics"
          className="ml-auto rounded-md border border-[#30363d] px-3 py-1 text-xs text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff] transition-colors"
        >
          {tJobs("analyticsLink")} →
        </Link>
      </div>
      <ResponsiveRecordViews
        isEmpty={jobs.length === 0}
        emptyMessage={tJobs("empty")}
        mobileCards={jobs.map((job) => {
          const canRequeue = canRequeueVideoJob(job.status);
          const canReprocess = canReprocessVideoJob(job.status);
          return (
            <RecordDetailCard key={job.id}>
              <RecordDetailField label={t("table.time")}>
                <FormattedDateTime value={job.createdAt} />
              </RecordDetailField>
              <RecordDetailField label={t("table.status")}>
                {job.status}
              </RecordDetailField>
              <RecordDetailField label={t("table.target")}>
                {job.scoreTarget ?? "—"}
              </RecordDetailField>
              <RecordDetailField label={t("table.file")}>
                <span className="wrap-break-word">
                  {job.fileName ?? job.id}
                </span>
              </RecordDetailField>
              <RecordDetailField label={tJobs("frameCount")}>
                {job.frameCount ?? "—"}
              </RecordDetailField>
              <RecordDetailField label={tJobs("totalTime")}>
                {formatJobDuration(readTimings(job.timingsJson)?.totalMs)}
              </RecordDetailField>
              <RecordDetailField label={tJobs("ocrTime")}>
                {formatJobDuration(
                  readTimings(job.timingsJson)?.phases?.["ashed.ocr_total"],
                )}
              </RecordDetailField>
              <RecordDetailField label={tJobs("bucketFilter")}>
                <div className="flex items-center gap-1.5">
                  <QualityBadge bucket={job.qualityBucket} />
                  {job.qualityScore != null ? (
                    <span className="text-xs text-[#8b949e]">
                      ({(job.qualityScore * 100).toFixed(0)}%)
                    </span>
                  ) : null}
                </div>
              </RecordDetailField>
              <RecordDetailField label={tJobs("actions")}>
                <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
                  <Link
                    href={`/admin/video-jobs/${job.id}`}
                    className="text-[#58a6ff] hover:underline"
                  >
                    {tJobs("inspect")}
                  </Link>
                  {job.errorMessage ? (
                    <button
                      type="button"
                      onClick={() => setErrorDialogJob(job)}
                      className="text-red-400 hover:underline"
                    >
                      {tJobs("viewError")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={actingJobId === job.id || !canRequeue}
                    title={
                      canRequeue ? undefined : tJobs("actionUnavailable")
                    }
                    onClick={() => void runAction(job.id, "requeue")}
                    className="text-[#58a6ff] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tJobs("requeue")}
                  </button>
                  <button
                    type="button"
                    disabled={actingJobId === job.id || !canReprocess}
                    title={
                      canReprocess ? undefined : tJobs("actionUnavailable")
                    }
                    onClick={() => void runAction(job.id, "reprocess")}
                    className="text-[#58a6ff] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tJobs("reprocess")}
                  </button>
                </div>
              </RecordDetailField>
            </RecordDetailCard>
          );
        })}
        desktopTable={
          <div className="overflow-x-auto rounded-xl border border-[#30363d]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#161b22] text-[#8b949e]">
                <tr>
                  <th className="px-4 py-2">{t("table.time")}</th>
                  <th className="px-4 py-2">{t("table.status")}</th>
                  <th className="px-4 py-2">{t("table.target")}</th>
                  <th className="px-4 py-2">{t("table.file")}</th>
                  <th className="px-4 py-2">{tJobs("frameCount")}</th>
                  <th className="px-4 py-2">{tJobs("totalTime")}</th>
                  <th className="px-4 py-2">{tJobs("ocrTime")}</th>
                  <th className="px-4 py-2">{tJobs("bucketFilter")}</th>
                  <th className="px-4 py-2">{tJobs("ratingFilter")}</th>
                  <th className="px-4 py-2">{tJobs("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const canRequeue = canRequeueVideoJob(job.status);
                  const canReprocess = canReprocessVideoJob(job.status);
                  return (
                    <tr key={job.id} className="border-t border-[#30363d]">
                      <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                        <FormattedDateTime value={job.createdAt} />
                      </td>
                      <td className="px-4 py-2">{job.status}</td>
                      <td className="px-4 py-2">{job.scoreTarget ?? "—"}</td>
                      <td className="max-w-xs truncate px-4 py-2">
                        {job.fileName ?? job.id}
                      </td>
                      <td className="px-4 py-2">{job.frameCount ?? "—"}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {formatJobDuration(readTimings(job.timingsJson)?.totalMs)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {formatJobDuration(
                          readTimings(job.timingsJson)?.phases?.[
                            "ashed.ocr_total"
                          ],
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <QualityBadge bucket={job.qualityBucket} />
                          {job.qualityScore != null ? (
                            <span className="text-xs text-[#8b949e]">
                              ({(job.qualityScore * 100).toFixed(0)}%)
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        {job.rating === "up" && (
                          <span title={job.ratingReason ?? undefined}>👍</span>
                        )}
                        {job.rating === "down" && (
                          <span className="text-[#8b949e]" title={job.ratingReason ?? undefined}>
                            👎{job.ratingReason ? ` ${job.ratingReason}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/video-jobs/${job.id}`}
                            className="text-xs text-[#58a6ff] hover:underline"
                          >
                            {tJobs("inspect")}
                          </Link>
                          {job.errorMessage ? (
                            <button
                              type="button"
                              onClick={() => setErrorDialogJob(job)}
                              className="text-xs text-red-400 hover:underline"
                            >
                              {tJobs("viewError")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={actingJobId === job.id || !canRequeue}
                            title={
                              canRequeue ? undefined : tJobs("actionUnavailable")
                            }
                            onClick={() => void runAction(job.id, "requeue")}
                            className="text-xs text-[#58a6ff] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {tJobs("requeue")}
                          </button>
                          <button
                            type="button"
                            disabled={actingJobId === job.id || !canReprocess}
                            title={
                              canReprocess
                                ? undefined
                                : tJobs("actionUnavailable")
                            }
                            onClick={() => void runAction(job.id, "reprocess")}
                            className="text-xs text-[#58a6ff] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {tJobs("reprocess")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        }
      />

      {errorDialogJob ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={() => setErrorDialogJob(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-job-error-title"
            className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#30363d] px-4 py-3">
              <h2
                id="video-job-error-title"
                className="text-sm font-medium text-[#e6edf3]"
              >
                {tJobs("errorDialogTitle")}
              </h2>
              <p className="mt-1 truncate text-xs text-[#8b949e]">
                {errorDialogJob.fileName ?? errorDialogJob.id}
              </p>
            </div>
            <div className="max-h-[50vh] overflow-auto px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-red-300">
                {errorDialogJob.errorMessage}
              </pre>
            </div>
            <div className="border-t border-[#30363d] px-4 py-3">
              <button
                type="button"
                onClick={() => setErrorDialogJob(null)}
                className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#e6edf3] hover:bg-[#21262d]"
              >
                {tJobs("close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
