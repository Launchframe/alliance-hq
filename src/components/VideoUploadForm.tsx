"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";
import { AppSelect } from "@/components/ui/AppSelect";
import { useMergedVideoJobs } from "@/components/video/VideoJobEventsProvider";
import type { VideoJobRow } from "@/lib/types/video";
import { MAX_VIDEO_UPLOAD_BYTES } from "@/lib/video/upload-limit";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ScoreTargetOption = {
  id: string;
  labelKey: string;
  group: string;
  leaderboardModel?: string;
  boardTypes?: string[];
  usesHqEvents?: boolean;
};

const GROUP_ORDER = ["events", "recurring", "hq-native"] as const;

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
  const [boardKey, setBoardKey] = useState("");
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

  const selectedTarget = scoreTargets.find((t) => t.id === scoreTarget);
  const needsBoardPicker =
    selectedTarget?.leaderboardModel === "multi-board";
  const effectiveBoardKey =
    boardKey || selectedTarget?.boardTypes?.[0] || "";

  function handleScoreTargetChange(nextId: string) {
    setScoreTarget(nextId);
    const next = scoreTargets.find((target) => target.id === nextId);
    if (next?.leaderboardModel === "multi-board") {
      setBoardKey(next.boardTypes?.[0] ?? "");
    } else {
      setBoardKey("");
    }
  }

  const fileTooLarge = file !== null && file.size > MAX_VIDEO_UPLOAD_BYTES;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError(t("chooseFileFirst"));
      return;
    }

    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError(
        t("fileTooLarge", {
          size: formatBytes(file.size),
        }),
      );
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("video", file);
    formData.set("scoreTarget", scoreTarget);
    if (effectiveBoardKey) {
      formData.set("boardKey", effectiveBoardKey);
    }

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
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="min-w-0 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:p-5"
      >
        <label className="block">
          <span className="mb-2 block text-sm text-[#8b949e]">
            {t("scoreTargetLabel")}
          </span>
          <AppSelect
            value={scoreTarget}
            onChange={handleScoreTargetChange}
            aria-label={t("scoreTargetLabel")}
            groups={GROUP_ORDER.map((group) => {
              const groupOptions = scoreTargets.filter((t) => t.group === group);
              if (groupOptions.length === 0) return null;
              return {
                label: tNav(`groups.${group}`),
                options: groupOptions.map((target) => ({
                  value: target.id,
                  label: tNav(target.labelKey),
                })),
              };
            }).filter((group): group is NonNullable<typeof group> => group !== null)}
          />
        </label>

        {needsBoardPicker ? (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm text-[#8b949e]">
              {t("boardLabel")}
            </span>
            <AppSelect
              value={effectiveBoardKey}
              onChange={setBoardKey}
              aria-label={t("boardLabel")}
              options={(selectedTarget?.boardTypes ?? []).map((board) => ({
                value: board,
                label: t(`boardTypes.${board}`),
              }))}
            />
          </label>
        ) : null}

        <label className="mt-4 block">
          <span className="mb-2 block text-sm text-[#8b949e]">
            {t("fileLabel")}
          </span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full max-w-full text-sm text-[#8b949e] file:mb-2 file:block file:w-full file:rounded-lg file:border-0 file:bg-[#238636] file:px-4 file:py-2 file:text-sm file:text-white sm:file:mb-0 sm:file:mr-4 sm:file:inline-block sm:file:w-auto"
          />
          <p className="mt-2 text-xs text-[#8b949e]">{t("fileHint")}</p>
          <p className="mt-2 text-xs text-[#8b949e]">{t("fileSizeLimit")}</p>
          <p className="mt-2 text-xs text-[#8b949e]">{t("fileSizeTipsIntro")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-[#8b949e]">
            <li>{t("fileSizeTipCrop")}</li>
            <li>{t("fileSizeTipTrim")}</li>
            <li>{t("fileSizeTipDownscale")}</li>
          </ul>
        </label>

        {file && (
          <p className="mt-2 break-all text-sm">
            {t("selectedFile", {
              name: file.name,
              size: formatBytes(file.size),
            })}
          </p>
        )}

        {fileTooLarge && (
          <p className="mt-2 text-sm text-[#f85149]">
            {t("fileTooLarge", { size: formatBytes(file.size) })}
          </p>
        )}

        {error && <p className="mt-4 text-sm text-[#f85149]">{error}</p>}
        {success && <p className="mt-4 text-sm text-[#3fb950]">{success}</p>}

        <button
          type="submit"
          disabled={uploading || !file || fileTooLarge}
          className="mt-4 w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50 sm:w-auto"
        >
          {uploading ? t("uploading") : t("uploadButton")}
        </button>
      </form>

      {jobs.length > 0 && (
        <section className="min-w-0 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:p-5">
          <h2 className="font-medium">{t("recentUploads")}</h2>
          <ul className="mt-3 space-y-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-col gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 w-full">
                  <p className="break-all font-medium sm:truncate">
                    {job.fileName ?? job.id}
                  </p>
                  <p className="text-xs text-[#8b949e]">
                    {job.scoreTarget ?? job.category} ·{" "}
                    {formatBytes(job.fileSizeBytes)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
