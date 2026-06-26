"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { RosterAllianceBanner } from "@/components/video/RosterAllianceBanner";
import { AppSelect } from "@/components/ui/AppSelect";
import { useMergedVideoJobs } from "@/components/video/VideoJobEventsProvider";
import { VideoSurveyDialog } from "@/components/video/VideoSurveyDialog";
import type { VideoJobRow } from "@/lib/types/video";
import {
  uploadVideoFile,
  type UploadConfig,
} from "@/lib/video/client-upload";
import type { SurveyPayload } from "@/lib/video/survey";
import {
  isLegacyDirectPostOverLimit,
  isVideoUploadOverLimit,
} from "@/lib/video/upload-limit";
import { jobMatchesScoreTarget } from "@/lib/video/score-target-nav";
import { isMemberRosterVideoTarget } from "@/lib/video/score-targets";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileExceedsUploadLimit(
  sizeBytes: number,
  uploadConfig: UploadConfig | null,
): boolean {
  if (isVideoUploadOverLimit(sizeBytes)) {
    return true;
  }
  if (uploadConfig?.mode === "direct") {
    return isLegacyDirectPostOverLimit(sizeBytes);
  }
  return false;
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

type ActiveSurvey = {
  jobId: string;
  file: File | null;
  initialSurvey: SurveyPayload | null;
  navigateOnClose: boolean;
};

type Props = {
  initialJobs: VideoJobRow[];
  memberName?: string | null;
  /** When set (from event page link), pre-selects target and filters recent uploads. */
  contextScoreTarget?: string | null;
  allianceTag?: string | null;
  allianceName?: string | null;
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
    "pending_approval",
  ] as const;
  if ((known as readonly string[]).includes(status)) {
    return t(`status.${status as (typeof known)[number]}`);
  }
  return status;
}

export function VideoUploadForm({
  initialJobs,
  memberName = null,
  contextScoreTarget = null,
  allianceTag = null,
  allianceName = null,
}: Props) {
  const t = useTranslations("video");
  const tNav = useTranslations("nav");
  const tc = useTranslations("common");
  const router = useRouter();

  const [scoreTargets, setScoreTargets] = useState<ScoreTargetOption[]>([
    { id: "desert-storm", labelKey: "desertStorm", group: "events" },
  ]);
  const [file, setFile] = useState<File | null>(null);
  const [scoreTarget, setScoreTarget] = useState(
    contextScoreTarget ?? "desert-storm",
  );
  const [boardKey, setBoardKey] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [uploadConfig, setUploadConfig] = useState<UploadConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeSurvey, setActiveSurvey] = useState<ActiveSurvey | null>(null);
  const [surveyCompleteByJobId, setSurveyCompleteByJobId] = useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries(
      initialJobs.map((job) => [job.id, job.surveyComplete ?? false]),
    ),
  );
  const [resumingSurveyJobId, setResumingSurveyJobId] = useState<string | null>(
    null,
  );
  const jobs = useMergedVideoJobs(initialJobs);
  const visibleJobs = contextScoreTarget
    ? jobs.filter((job) => jobMatchesScoreTarget(job, contextScoreTarget))
    : jobs;

  useEffect(() => {
    void fetch("/api/tools/video-upload")
      .then((r) => r.json())
      .then(
        (data: {
          scoreTargets?: ScoreTargetOption[];
          upload?: UploadConfig;
        }) => {
          if (data.upload) {
            setUploadConfig(data.upload);
          }
          if (!data.scoreTargets?.length) return;
          setScoreTargets(data.scoreTargets);
          if (!contextScoreTarget) return;
          const target = data.scoreTargets.find(
            (row) => row.id === contextScoreTarget,
          );
          if (target?.leaderboardModel === "multi-board") {
            setBoardKey(target.boardTypes?.[0] ?? "");
          }
        },
      )
      .catch(() => undefined);
  }, [contextScoreTarget]);

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

  const maxUploadLabel = useMemo(() => {
    if (!uploadConfig) return null;
    return formatBytes(uploadConfig.maxUploadBytes);
  }, [uploadConfig]);

  const fileTooLarge =
    file !== null && fileExceedsUploadLimit(file.size, uploadConfig);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError(t("chooseFileFirst"));
      return;
    }

    if (!uploadConfig) {
      setError(tc("uploadFailed"));
      return;
    }

    if (fileExceedsUploadLimit(file.size, uploadConfig)) {
      setError(
        t("fileTooLarge", {
          size: formatBytes(file.size),
          maxSize: maxUploadLabel ?? formatBytes(uploadConfig.maxUploadBytes),
        }),
      );
      return;
    }

    setUploading(true);
    setUploadProgress({ loaded: 0, total: file.size });
    setError(null);
    setSuccess(null);

    try {
      const data = await uploadVideoFile({
        file,
        scoreTarget,
        boardKey: effectiveBoardKey || undefined,
        uploadConfig,
        onProgress: (loaded, total) => {
          setUploadProgress({ loaded, total });
        },
      });

      setSuccess(data.message ?? t("queuedSuccess"));
      setSurveyCompleteByJobId((prev) => ({
        ...prev,
        [data.jobId]: false,
      }));
      setActiveSurvey({
        jobId: data.jobId,
        file,
        initialSurvey: null,
        navigateOnClose: data.status !== "pending_approval",
      });
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  function handleSurveyClose(result: { complete: boolean }) {
    const session = activeSurvey;
    setActiveSurvey(null);
    if (session?.jobId) {
      setSurveyCompleteByJobId((prev) => ({
        ...prev,
        [session.jobId]: result.complete,
      }));
    }
    if (session?.navigateOnClose && session.jobId) {
      router.push(`/tools/video-upload/${session.jobId}/review`);
    }
  }

  async function resumeSurvey(jobId: string) {
    setResumingSurveyJobId(jobId);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/survey`);
      const data = (await res.json()) as {
        error?: string;
        complete?: boolean;
        survey?: SurveyPayload | null;
      };
      if (!res.ok) {
        setError(data.error ?? tc("uploadFailed"));
        return;
      }
      if (data.complete) {
        setSurveyCompleteByJobId((prev) => ({ ...prev, [jobId]: true }));
        return;
      }
      setActiveSurvey({
        jobId,
        file: null,
        initialSurvey: data.survey ?? null,
        navigateOnClose: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setResumingSurveyJobId(null);
    }
  }

  function isSurveyIncomplete(job: VideoJobRow): boolean {
    if (job.status === "failed" || job.status === "discarded") return false;
    return !(surveyCompleteByJobId[job.id] ?? job.surveyComplete ?? false);
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        <p className="mt-2 text-xs text-[#8b949e]">{t("pendingApprovalHint")}</p>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="min-w-0 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:p-5"
      >
        {isMemberRosterVideoTarget(scoreTarget) && allianceTag ? (
          <div className="mb-4">
            <RosterAllianceBanner tag={allianceTag} name={allianceName} />
          </div>
        ) : null}
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
          {maxUploadLabel ? (
            <p className="mt-2 text-xs text-[#8b949e]">
              {t("fileSizeLimit", { maxSize: maxUploadLabel })}
            </p>
          ) : null}
        </label>

        {file && (
          <p className="mt-2 break-all text-sm">
            {t("selectedFile", {
              name: file.name,
              size: formatBytes(file.size),
            })}
          </p>
        )}

        {uploadProgress && uploadProgress.total > 0 ? (
          <div className="mt-3">
            <div
              className="h-2 overflow-hidden rounded-full bg-[#21262d]"
              role="progressbar"
              aria-valuenow={uploadProgress.loaded}
              aria-valuemin={0}
              aria-valuemax={uploadProgress.total}
              aria-label={t("uploading")}
            >
              <div
                className="h-full bg-[#238636] transition-[width] duration-150"
                style={{
                  width: `${Math.min(100, (uploadProgress.loaded / uploadProgress.total) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-[#8b949e]">
              {formatBytes(uploadProgress.loaded)} /{" "}
              {formatBytes(uploadProgress.total)}
            </p>
          </div>
        ) : null}

        {fileTooLarge && maxUploadLabel ? (
          <p className="mt-2 text-sm text-[#f85149]">
            {t("fileTooLarge", {
              size: formatBytes(file.size),
              maxSize: maxUploadLabel,
            })}
          </p>
        ) : null}

        {error && <p className="mt-4 text-sm text-[#f85149]">{error}</p>}
        {success && <p className="mt-4 text-sm text-[#3fb950]">{success}</p>}

        <button
          type="submit"
          disabled={uploading || !file || fileTooLarge || !uploadConfig}
          className="mt-4 w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50 sm:w-auto"
        >
          {uploading ? t("uploading") : t("uploadButton")}
        </button>
      </form>

      {visibleJobs.length > 0 && (
        <section className="min-w-0 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{t("recentUploads")}</h2>
            {contextScoreTarget ? (
              <Link
                href="/tools/video-upload"
                className="text-xs text-[#58a6ff] hover:underline"
              >
                {t("viewAllUploads")}
              </Link>
            ) : null}
          </div>
          <ul className="mt-3 space-y-2">
            {visibleJobs.map((job) => (
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
                      href={
                        job.status === "complete"
                          ? `/tools/video-upload/${job.id}/event`
                          : `/tools/video-upload/${job.id}/review`
                      }
                      className="text-xs text-[#58a6ff] hover:underline"
                    >
                      {job.status === "complete"
                        ? t("eventLink")
                        : t("reviewLink")}
                    </Link>
                  )}
                  {isSurveyIncomplete(job) ? (
                    <button
                      type="button"
                      disabled={resumingSurveyJobId === job.id}
                      onClick={() => void resumeSurvey(job.id)}
                      className="text-xs text-[#58a6ff] hover:underline disabled:opacity-50"
                    >
                      {resumingSurveyJobId === job.id
                        ? t("surveyResumeLoading")
                        : t("surveyResumeLink")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeSurvey ? (
        <VideoSurveyDialog
          jobId={activeSurvey.jobId}
          file={activeSurvey.file}
          memberName={memberName}
          initialSurvey={activeSurvey.initialSurvey}
          open={true}
          onClose={handleSurveyClose}
        />
      ) : null}
    </div>
  );
}
