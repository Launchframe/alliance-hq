"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

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
              <th className="px-4 py-2">{t("table.error")}</th>
              <th className="px-4 py-2">{tJobs("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-[#30363d]">
                <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                  {new Date(job.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2">{job.status}</td>
                <td className="px-4 py-2">{job.scoreTarget ?? "—"}</td>
                <td className="px-4 py-2">{job.fileName ?? job.id}</td>
                <td className="max-w-xs truncate px-4 py-2 text-red-400">
                  {job.errorMessage ?? "—"}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={actingJobId === job.id}
                      onClick={() => void runAction(job.id, "requeue")}
                      className="text-xs text-[#58a6ff] hover:underline disabled:opacity-50"
                    >
                      {tJobs("requeue")}
                    </button>
                    <button
                      type="button"
                      disabled={actingJobId === job.id}
                      onClick={() => void runAction(job.id, "reprocess")}
                      className="text-xs text-[#58a6ff] hover:underline disabled:opacity-50"
                    >
                      {tJobs("reprocess")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
