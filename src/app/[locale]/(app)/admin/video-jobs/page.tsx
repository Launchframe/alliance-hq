"use client";

import { useEffect, useState } from "react";
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
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/video-jobs?limit=200")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ jobs: VideoJob[] }>;
      })
      .then((data) => setJobs(data.jobs))
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("loadFailed")),
      );
  }, [t]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#30363d]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#161b22] text-[#8b949e]">
          <tr>
            <th className="px-4 py-2">{t("table.time")}</th>
            <th className="px-4 py-2">{t("table.status")}</th>
            <th className="px-4 py-2">{t("table.target")}</th>
            <th className="px-4 py-2">{t("table.file")}</th>
            <th className="px-4 py-2">{t("table.error")}</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
