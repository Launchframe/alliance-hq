"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import type { AllianceQueueJob } from "@/app/api/tools/video-upload/queue/route";

type Props = {
  initialJobs: AllianceQueueJob[];
  canProcess: boolean;
  ashedConnected: boolean;
  connectUrl: string;
};

export function VideoQueueClient({
  initialJobs,
  canProcess,
  ashedConnected,
  connectUrl,
}: Props) {
  const t = useTranslations("videoQueue");
  const router = useRouter();
  const [jobs, setJobs] = useState<AllianceQueueJob[]>(initialJobs);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tools/video-upload/queue");
    if (!res.ok) return;
    const data = (await res.json()) as { jobs: AllianceQueueJob[] };
    setJobs(data.jobs);
  }, []);

  const goConnect = useCallback(() => {
    router.push(connectUrl);
  }, [router, connectUrl]);

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

  const showConnectBanner = canProcess && !ashedConnected;

  return (
    <div className="min-w-0 space-y-3">
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
        emptyMessage={t("empty")}
        mobileCards={jobs.map((job) => (
          <RecordDetailCard key={job.id}>
            <RecordDetailField label={t("table.time")}>
              <FormattedDateTime value={job.createdAt} />
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
            {canProcess ? (
              <RecordDetailField label={t("table.actions")}>
                <JobActions
                  jobId={job.id}
                  acting={actingJobId === job.id}
                  ashedConnected={ashedConnected}
                  onApprove={() => void approve(job.id)}
                  onReject={() => void reject(job.id)}
                  onConnect={goConnect}
                  t={t}
                />
              </RecordDetailField>
            ) : null}
          </RecordDetailCard>
        ))}
        desktopTable={
          <div className="overflow-x-auto rounded-xl border border-[#30363d]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#161b22] text-[#8b949e]">
                <tr>
                  <th className="px-4 py-2">{t("table.time")}</th>
                  <th className="px-4 py-2">{t("table.uploadedBy")}</th>
                  <th className="px-4 py-2">{t("table.target")}</th>
                  <th className="px-4 py-2">{t("table.file")}</th>
                  {canProcess ? (
                    <th className="px-4 py-2">{t("table.actions")}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-[#30363d]">
                    <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                      <FormattedDateTime value={job.createdAt} />
                    </td>
                    <td className="px-4 py-2">{job.enqueuedBy ?? "—"}</td>
                    <td className="px-4 py-2">{job.scoreTarget ?? "—"}</td>
                    <td className="max-w-xs truncate px-4 py-2">
                      {job.fileName ?? job.id}
                    </td>
                    {canProcess ? (
                      <td className="px-4 py-2">
                        <JobActions
                          jobId={job.id}
                          acting={actingJobId === job.id}
                          ashedConnected={ashedConnected}
                          onApprove={() => void approve(job.id)}
                          onReject={() => void reject(job.id)}
                          onConnect={goConnect}
                          t={t}
                        />
                      </td>
                    ) : null}
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

function JobActions({
  acting,
  ashedConnected,
  onApprove,
  onReject,
  onConnect,
  t,
}: {
  jobId: string;
  acting: boolean;
  ashedConnected: boolean;
  onApprove: () => void;
  onReject: () => void;
  onConnect: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
      {ashedConnected ? (
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
