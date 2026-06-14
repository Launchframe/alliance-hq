"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";

import {
  canReprocessVideoJob,
  canRequeueVideoJob,
} from "@/lib/video/admin-job-actions";

type VideoJob = {
  id: string;
  status: string;
  fileName: string | null;
  scoreTarget: string | null;
  allianceId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export default function AdminVideoJobsPage() {
  const t = useTranslations("admin");
  const tJobs = useTranslations("admin.videoJobsPage");
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [errorDialogJob, setErrorDialogJob] = useState<VideoJob | null>(null);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/admin/video-jobs?limit=200");
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { jobs: VideoJob[] };
    setJobs(data.jobs);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadJobs();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [loadJobs, t]);

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
      await loadJobs();
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
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-[#30363d]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#161b22] text-[#8b949e]">
            <tr>
              <th className="px-4 py-2">{t("table.time")}</th>
              <th className="px-4 py-2">{t("table.status")}</th>
              <th className="px-4 py-2">{t("table.target")}</th>
              <th className="px-4 py-2">{t("table.file")}</th>
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
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
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
                          canReprocess ? undefined : tJobs("actionUnavailable")
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
