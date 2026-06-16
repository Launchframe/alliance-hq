"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Link } from "@/i18n/navigation";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import { SURVEY_SCROLL_STYLES, type SurveyScrollStyle } from "@/lib/video/survey";

type JobDetail = {
  id: string;
  status: string;
  fileName: string | null;
  scoreTarget: string | null;
  frameCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  timingsJson: VideoProcessTimings | null;
  totalFileSizeBytes: number | null;
  rating?: string | null;
};

type FrameRow = {
  frameIndex: number;
  uploadMs: number | null;
  extractMs: number | null;
  ocrEntryCount: number | null;
  ocrError: string | null;
  ocrRawJson: unknown;
};

type ParsedRow = {
  id: string;
  ocrName: string;
  score: string;
  scoreConflict: number;
  memberName: string | null;
  matchConfidence: number | null;
  deleted: number;
  edited: number;
  manuallyAdded: number;
};

type SurveyData = {
  rowCountEstimate: number | null;
  scrollStyle: string | null;
  aboveAverageScroll: boolean | null;
};

type DetailResponse = {
  job: JobDetail;
  frames: FrameRow[];
  parsedRows: ParsedRow[];
  editCount: number;
  deleteCount: number;
  addCount: number;
  sameFileResubmits: number;
  survey: SurveyData | null;
};

type TabId = "frames" | "parse" | "timings";
type FrameViewMode = "list" | "gallery" | "video";

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSurveyScrollStyle(
  scrollStyle: string | null,
  tSurvey: ReturnType<typeof useTranslations<"videoSurvey">>,
): string {
  if (!scrollStyle) return "—";
  if ((SURVEY_SCROLL_STYLES as readonly string[]).includes(scrollStyle)) {
    return tSurvey(`scrollStyle.${scrollStyle as SurveyScrollStyle}`);
  }
  return scrollStyle;
}

export function AdminVideoJobDetailView({ jobId }: { jobId: string }) {
  const t = useTranslations("admin");
  const tDetail = useTranslations("admin.videoJobDetailPage");
  const tSurvey = useTranslations("videoSurvey");
  const tc = useTranslations("common");
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("frames");
  const [expandedFrames, setExpandedFrames] = useState<Set<number>>(new Set());

  // Frame view mode
  const [frameViewMode, setFrameViewMode] = useState<FrameViewMode>("list");

  // Gallery mode state
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0);
  const galleryVelocityRef = useRef(0);
  const galleryDragStartRef = useRef<number | null>(null);

  // Video / slideshow mode state
  const [videoModeIndex, setVideoModeIndex] = useState(0);
  const [videoModePlaying, setVideoModePlaying] = useState(false);
  const [videoModeFps, setVideoModeFps] = useState(3);
  const videoModeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/admin/video-jobs/${jobId}`);
    if (!res.ok) throw new Error(await res.text());
    setData((await res.json()) as DetailResponse);
  }, [jobId]);

  useEffect(() => {
    void (async () => {
      try {
        await loadDetail();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [jobId, loadDetail, t]);

  const frames = data?.frames ?? [];

  // Clamp gallery index to valid range (derived at render, no effect needed)
  const safeGalleryIndex = frames.length > 0
    ? Math.min(currentGalleryIndex, frames.length - 1)
    : 0;

  // Video slideshow interval
  useEffect(() => {
    if (!videoModePlaying || frameViewMode !== "video") {
      if (videoModeTimerRef.current) {
        clearInterval(videoModeTimerRef.current);
        videoModeTimerRef.current = null;
      }
      return;
    }
    videoModeTimerRef.current = setInterval(() => {
      setVideoModeIndex((prev) => {
        if (prev >= frames.length - 1) {
          setVideoModePlaying(false);
          setTimeout(() => {
            setVideoModeIndex(0);
            setVideoModePlaying(true);
          }, 1000);
          return prev;
        }
        return prev + 1;
      });
    }, Math.round(1000 / videoModeFps));
    return () => {
      if (videoModeTimerRef.current) clearInterval(videoModeTimerRef.current);
    };
  }, [videoModePlaying, videoModeFps, frameViewMode, frames.length]);

  const phaseBars = useMemo(() => {
    const phases = data?.job.timingsJson?.phases;
    if (!phases) return [];
    return Object.entries(phases)
      .filter(([, ms]) => ms > 0)
      .sort(([, a], [, b]) => b - a);
  }, [data?.job.timingsJson?.phases]);

  const maxPhaseMs = phaseBars[0]?.[1] ?? 1;

  function toggleFrameRaw(frameIndex: number) {
    setExpandedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(frameIndex)) {
        next.delete(frameIndex);
      } else {
        next.add(frameIndex);
      }
      return next;
    });
  }

  if (error && !data) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (!data) {
    return <p className="text-sm text-[#8b949e]">{tDetail("loading")}</p>;
  }

  const { job, frames, parsedRows, editCount, deleteCount, addCount, sameFileResubmits } =
    data;
  const timings = job.timingsJson;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/video-jobs"
          className="text-sm text-[#58a6ff] hover:underline"
        >
          {tDetail("backToList")}
        </Link>
        <h1 className="min-w-0 truncate text-lg font-medium text-[#e6edf3]">
          {job.fileName ?? job.id}
        </h1>
      </div>

      <div className="grid gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-[#8b949e]">{t("table.status")}</p>
          <p>{job.status}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{t("table.target")}</p>
          <p>{job.scoreTarget ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{t("table.time")}</p>
          <p>
            <FormattedDateTime value={job.createdAt} />
          </p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{tDetail("frameCount")}</p>
          <p>{job.frameCount ?? frames.length}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{tDetail("totalTime")}</p>
          <p>{formatMs(timings?.totalMs)}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{tDetail("ocrTime")}</p>
          <p>{formatMs(timings?.phases?.["ashed.ocr_total"])}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{tDetail("frameBytes")}</p>
          <p>{formatBytes(job.totalFileSizeBytes)}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{tDetail("sameFileResubmits")}</p>
          <p>{sameFileResubmits}</p>
        </div>
        <div>
          <p className="text-xs text-[#8b949e]">{tDetail("rating")}</p>
          <p>
            {job.rating === "thumbs_up"
              ? "👍"
              : job.rating === "thumbs_down"
                ? "👎"
                : "—"}
          </p>
        </div>
      </div>

      {data.survey ? (
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#8b949e]">
            {tDetail("surveyTitle")}
          </p>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-[#8b949e]">{tDetail("surveyRowCount")}</p>
              <p>{data.survey.rowCountEstimate ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-[#8b949e]">{tDetail("surveyScrollStyle")}</p>
              <p>{formatSurveyScrollStyle(data.survey.scrollStyle, tSurvey)}</p>
            </div>
            <div>
              <p className="text-xs text-[#8b949e]">{tDetail("surveyAboveAvg")}</p>
              <p>
                {data.survey.aboveAverageScroll === true
                  ? tc("yes")
                  : data.survey.aboveAverageScroll === false
                    ? tc("no")
                    : "—"}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {job.errorMessage ? (
        <pre className="overflow-auto rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-xs text-red-300">
          {job.errorMessage}
        </pre>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-[#30363d] pb-2">
        {(["frames", "parse", "timings"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === id
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {tDetail(`tabs.${id}`)}
          </button>
        ))}
      </div>

      {tab === "frames" ? (
        frames.length === 0 ? (
          <p className="text-sm text-[#8b949e]">{tDetail("framesEmpty")}</p>
        ) : (
          <div className="space-y-4">
            {/* View mode switcher */}
            <div className="flex gap-1">
              {(["list", "gallery", "video"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFrameViewMode(mode)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    frameViewMode === mode
                      ? "bg-[#21262d] text-[#e6edf3]"
                      : "text-[#8b949e] hover:text-[#e6edf3]"
                  }`}
                >
                  {tDetail(`viewMode.${mode}`)}
                </button>
              ))}
            </div>

            {/* List mode */}
            {frameViewMode === "list" ? (
              <ul className="space-y-3">
                {frames.map((frame) => (
                  <li
                    key={frame.frameIndex}
                    className="rounded-xl border border-[#30363d] bg-[#161b22] p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row">
                      {/* eslint-disable-next-line @next/next/no-img-element -- admin-only JPEG from authenticated API route */}
                      <img
                        src={`/api/admin/video-jobs/${jobId}/frames/${frame.frameIndex}`}
                        alt={tDetail("frameThumbnail", {
                          index: frame.frameIndex,
                        })}
                        className="h-24 w-auto max-w-full rounded border border-[#30363d] object-contain"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-medium text-[#e6edf3]">
                          {tDetail("frameLabel", { index: frame.frameIndex })}
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded bg-[#21262d] px-2 py-0.5 text-[#8b949e]">
                            {tDetail("uploadMs", {
                              ms: formatMs(frame.uploadMs),
                            })}
                          </span>
                          <span className="rounded bg-[#21262d] px-2 py-0.5 text-[#8b949e]">
                            {tDetail("extractMs", {
                              ms: formatMs(frame.extractMs),
                            })}
                          </span>
                          <span className="rounded bg-[#21262d] px-2 py-0.5 text-[#8b949e]">
                            {tDetail("entryCount", {
                              count: frame.ocrEntryCount ?? 0,
                            })}
                          </span>
                          {frame.ocrError ? (
                            <span className="rounded bg-red-950/50 px-2 py-0.5 text-red-300">
                              {frame.ocrError}
                            </span>
                          ) : null}
                        </div>
                        {frame.ocrRawJson != null ? (
                          <button
                            type="button"
                            onClick={() => toggleFrameRaw(frame.frameIndex)}
                            className="text-xs text-[#58a6ff] hover:underline"
                          >
                            {expandedFrames.has(frame.frameIndex)
                              ? tDetail("hideRaw")
                              : tDetail("showRaw")}
                          </button>
                        ) : null}
                        {expandedFrames.has(frame.frameIndex) ? (
                          <pre className="max-h-48 overflow-auto rounded border border-[#30363d] bg-[#0d1117] p-2 text-xs text-[#8b949e]">
                            {JSON.stringify(frame.ocrRawJson, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Gallery mode — 3D CSS carousel */}
            {frameViewMode === "gallery" ? (
              <div className="relative select-none overflow-hidden py-8">
                <div
                  className="relative mx-auto h-48 w-full"
                  style={{ perspective: "800px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    galleryDragStartRef.current = e.clientX;
                  }}
                  onMouseMove={(e) => {
                    if (galleryDragStartRef.current == null) return;
                    const delta = e.clientX - galleryDragStartRef.current;
                    galleryVelocityRef.current = delta;
                  }}
                  onMouseUp={() => {
                    const vel = galleryVelocityRef.current;
                    galleryDragStartRef.current = null;
                    if (Math.abs(vel) > 30) {
                      setCurrentGalleryIndex((prev) =>
                        Math.max(
                          0,
                          Math.min(frames.length - 1, prev + (vel < 0 ? 1 : -1)),
                        ),
                      );
                    }
                    galleryVelocityRef.current = 0;
                  }}
                  onMouseLeave={() => {
                    galleryDragStartRef.current = null;
                    galleryVelocityRef.current = 0;
                  }}
                  onTouchStart={(e) => {
                    galleryDragStartRef.current =
                      e.touches[0]?.clientX ?? null;
                  }}
                  onTouchEnd={(e) => {
                    const startX = galleryDragStartRef.current;
                    galleryDragStartRef.current = null;
                    if (startX == null) return;
                    const endX = e.changedTouches[0]?.clientX ?? startX;
                    const delta = endX - startX;
                    if (Math.abs(delta) > 40) {
                      setCurrentGalleryIndex((prev) =>
                        Math.max(
                          0,
                          Math.min(
                            frames.length - 1,
                            prev + (delta < 0 ? 1 : -1),
                          ),
                        ),
                      );
                    }
                  }}
                >
                  {frames.map((frame, i) => {
                    const offset = i - safeGalleryIndex;
                    const visibleRange = 2;
                    if (Math.abs(offset) > visibleRange) return null;
                    const translateX = offset * 60;
                    const rotateY = offset * -30;
                    const scale = 1 - Math.abs(offset) * 0.15;
                    const opacity = 1 - Math.abs(offset) * 0.35;
                    const zIndex = visibleRange - Math.abs(offset);
                    return (
                      <div
                        key={frame.frameIndex}
                        className="absolute left-1/2 top-0 -translate-x-1/2 cursor-pointer transition-transform duration-300"
                        style={{
                          transform: `translateX(${translateX}%) rotateY(${rotateY}deg) scale(${scale})`,
                          opacity,
                          zIndex,
                          transformStyle: "preserve-3d",
                        }}
                        onClick={() => setCurrentGalleryIndex(i)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setCurrentGalleryIndex(i);
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- admin gallery */}
                        <img
                          src={`/api/admin/video-jobs/${jobId}/frames/${frame.frameIndex}`}
                          alt={tDetail("frameThumbnail", {
                            index: frame.frameIndex,
                          })}
                          className="h-48 w-auto max-w-xs rounded border border-[#30363d] object-contain"
                        />
                        {i === safeGalleryIndex ? (
                          <div className="absolute bottom-0 left-0 right-0 rounded-b border border-t-0 border-[#30363d] bg-[#161b22]/90 px-2 py-1 text-center text-xs text-[#8b949e]">
                            {tDetail("frameLabel", { index: frame.frameIndex })}
                            {" · "}
                            {tDetail("entryCount", {
                              count: frame.ocrEntryCount ?? 0,
                            })}
                            {frame.ocrError ? ` · ⚠ ${frame.ocrError}` : ""}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentGalleryIndex((prev) => Math.max(0, prev - 1))
                    }
                    disabled={safeGalleryIndex === 0}
                    className="rounded px-3 py-1 text-sm text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30"
                    aria-label={tDetail("galleryPrev")}
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-[#8b949e]">
                    {safeGalleryIndex + 1} / {frames.length}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentGalleryIndex((prev) =>
                        Math.min(frames.length - 1, prev + 1),
                      )
                    }
                    disabled={safeGalleryIndex === frames.length - 1}
                    className="rounded px-3 py-1 text-sm text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30"
                    aria-label={tDetail("galleryNext")}
                  >
                    Next →
                  </button>
                </div>
              </div>
            ) : null}

            {/* Video / slideshow mode */}
            {frameViewMode === "video" ? (
              <div className="space-y-4">
                <div className="relative mx-auto max-w-md">
                  {frames[videoModeIndex] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin slideshow
                    <img
                      src={`/api/admin/video-jobs/${jobId}/frames/${frames[videoModeIndex]!.frameIndex}`}
                      alt={tDetail("frameThumbnail", {
                        index: frames[videoModeIndex]!.frameIndex,
                      })}
                      className="w-full rounded-lg border border-[#30363d] object-contain"
                    />
                  ) : null}
                  <div className="mt-2 text-center text-xs text-[#8b949e]">
                    {tDetail("frameLabel", {
                      index: frames[videoModeIndex]?.frameIndex ?? 0,
                    })}
                    {" · "}
                    {tDetail("entryCount", {
                      count: frames[videoModeIndex]?.ocrEntryCount ?? 0,
                    })}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setVideoModePlaying((p) => !p)}
                    className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:bg-[#21262d]"
                  >
                    {videoModePlaying
                      ? tDetail("videoPause")
                      : tDetail("videoPlay")}
                  </button>
                  <label className="flex items-center gap-3 text-sm">
                    <span className="text-[#8b949e]">
                      {tDetail("videoFps")}
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={15}
                      value={videoModeFps}
                      onChange={(e) => setVideoModeFps(Number(e.target.value))}
                      className="w-32"
                    />
                    <span className="w-8 text-center text-[#e6edf3]">
                      {videoModeFps}
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={frames.length - 1}
                      value={videoModeIndex}
                      onChange={(e) => {
                        setVideoModeIndex(Number(e.target.value));
                        setVideoModePlaying(false);
                      }}
                      className="w-64"
                    />
                    <span className="text-xs text-[#8b949e]">
                      {videoModeIndex + 1} / {frames.length}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {tab === "parse" ? (
        <div className="space-y-3">
          <p className="text-sm text-[#8b949e]">
            {tDetail("parseSummary", { editCount, deleteCount })}
            {addCount > 0 && (
              <> · {tDetail("addCount", { count: addCount })}</>
            )}
          </p>
          {parsedRows.length === 0 ? (
            <p className="text-sm text-[#8b949e]">{tDetail("parseEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#30363d]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#161b22] text-[#8b949e]">
                  <tr>
                    <th className="px-3 py-2">{tDetail("colOcrName")}</th>
                    <th className="px-3 py-2">{tDetail("colScore")}</th>
                    <th className="px-3 py-2">{tDetail("colConflict")}</th>
                    <th className="px-3 py-2">{tDetail("colMember")}</th>
                    <th className="px-3 py-2">{tDetail("colConfidence")}</th>
                    <th className="px-3 py-2">{tDetail("colFlags")}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-t border-[#30363d] ${
                        row.deleted === 1 ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-3 py-2">{row.ocrName}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.score}
                      </td>
                      <td className="px-3 py-2">
                        {row.scoreConflict === 1 ? tDetail("yes") : "—"}
                      </td>
                      <td className="px-3 py-2">{row.memberName ?? "—"}</td>
                      <td className="px-3 py-2">
                        {row.matchConfidence != null
                          ? `${Math.round(row.matchConfidence * 100)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-[#8b949e]">
                        {row.manuallyAdded === 1 ? tDetail("added") : null}
                        {row.manuallyAdded === 1 && (row.edited === 1 || row.deleted === 1) ? " · " : null}
                        {row.edited === 1 ? tDetail("edited") : null}
                        {row.edited === 1 && row.deleted === 1 ? " · " : null}
                        {row.deleted === 1 ? tDetail("deleted") : null}
                        {row.manuallyAdded !== 1 && row.edited !== 1 && row.deleted !== 1 ? "—" : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "timings" ? (
        !timings ? (
          <p className="text-sm text-[#8b949e]">{tDetail("timingsEmpty")}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[#8b949e]">
              {tDetail("timingsSummary", {
                total: formatMs(timings.totalMs),
                ffmpeg: formatMs(timings.phases?.["ffmpeg.extract"]),
                ocr: formatMs(timings.phases?.["ashed.ocr_total"]),
                frames: timings.frameCount,
              })}
            </p>
            <ul className="space-y-2">
              {phaseBars.map(([phase, ms]) => (
                <li key={phase}>
                  <div className="mb-1 flex justify-between text-xs text-[#8b949e]">
                    <span className="truncate pr-2">{phase}</span>
                    <span className="shrink-0">{formatMs(ms)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-[#21262d]">
                    <div
                      className="h-full rounded bg-[#58a6ff]"
                      style={{
                        width: `${Math.max(2, (ms / maxPhaseMs) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}
