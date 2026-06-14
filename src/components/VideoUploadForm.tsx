"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";
import { useMergedVideoJobs } from "@/components/video/VideoJobEventsProvider";
import type { VideoJobRow } from "@/lib/types/video";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ScoreTargetOption = {
  id: string;
  labelKey: string;
  group: string;
};

type Props = {
  initialJobs: VideoJobRow[];
};

function statusLabel(
  t: ReturnType<typeof useTranslations<"video">>,
  status: string,
): string {
  const known = [
    "queued",
    "extracting",
    "parsing",
    "review",
    "submitting",
    "complete",
    "failed",
  ] as const;
  if ((known as readonly string[]).includes(status)) {
    return t(`status.${status as (typeof known)[number]}`);
  }
  return status;
}

export function VideoUploadForm({ initialJobs }: Props) {
  const t = useTranslations("video");
  const tNav = useTranslations("nav");
  const tc = useTranslations("common");

  const [scoreTargets, setScoreTargets] = useState<ScoreTargetOption[]>([
    { id: "desert-storm", labelKey: "desertStorm", group: "events" },
  ]);
  const [file, setFile] = useState<File | null>(null);
  const [scoreTarget, setScoreTarget] = useState("desert-storm");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const jobs = useMergedVideoJobs(initialJobs);

  useEffect(() => {
    void fetch("/api/tools/video-upload")
      .then((r) => r.json())
      .then((data: { scoreTargets?: ScoreTargetOption[] }) => {
        if (data.scoreTargets?.length) {
          setScoreTargets(data.scoreTargets);
        }
      })
      .catch(() => undefined);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError(t("chooseFileFirst"));
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("video", file);
    formData.set("scoreTarget", scoreTarget);

    try {
      const res = await fetch("/api/tools/video-upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        jobId?: string;
      };

      if (!res.ok) {
        setError(data.error ?? tc("uploadFailed"));
        return;
      }

      setSuccess(data.message ?? t("queuedSuccess"));
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-xl border border-[#30363d] bg-[#161b22] p-5"
      >
        <label className="block">
          <span className="mb-2 block text-sm text-[#8b949e]">
            {t("scoreTargetLabel")}
          </span>
          <select
            value={scoreTarget}
            onChange={(e) => setScoreTarget(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
          >
            {scoreTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {tNav(target.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block">
          <span className="mb-2 block text-sm text-[#8b949e]">
            {t("fileLabel")}
          </span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-[#8b949e] file:mr-4 file:rounded-lg file:border-0 file:bg-[#238636] file:px-4 file:py-2 file:text-sm file:text-white"
          />
          <p className="mt-2 text-xs text-[#8b949e]">{t("fileHint")}</p>
        </label>

        {file && (
          <p className="mt-2 text-sm">
            {t("selectedFile", {
              name: file.name,
              size: formatBytes(file.size),
            })}
          </p>
        )}

        {error && <p className="mt-4 text-sm text-[#f85149]">{error}</p>}
        {success && <p className="mt-4 text-sm text-[#3fb950]">{success}</p>}

        <button
          type="submit"
          disabled={uploading || !file}
          className="mt-4 rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {uploading ? t("uploading") : t("uploadButton")}
        </button>
      </form>

      {jobs.length > 0 && (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="font-medium">{t("recentUploads")}</h2>
          <ul className="mt-3 space-y-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {job.fileName ?? job.id}
                  </p>
                  <p className="text-xs text-[#8b949e]">
                    {job.scoreTarget ?? job.category} ·{" "}
                    {formatBytes(job.fileSizeBytes)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      job.status === "complete"
                        ? "bg-[#23863633] text-[#3fb950]"
                        : job.status === "failed"
                          ? "bg-[#f8514933] text-[#f85149]"
                          : "bg-[#1f3d5c] text-[#58a6ff]"
                    }`}
                  >
                    {statusLabel(t, job.status)}
                  </span>
                  {(job.status === "review" || job.status === "complete") && (
                    <Link
                      href={`/tools/video-upload/${job.id}/review`}
                      className="text-xs text-[#58a6ff] hover:underline"
                    >
                      {t("reviewLink")}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
