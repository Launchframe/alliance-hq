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
  qualityBucket?: string | null;
  qualityScore?: number | null;
};

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

type GroupPass = {
  id: string;
  passKey: string | null;
  passRole: string | null;
  status: string;
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
  groupPasses?: GroupPass[];
};

type TabId = "frames" | "parse" | "timings";
type FrameViewMode = "list" | "gallery" | "video";

const BASE_FRAME_HEIGHT_PX = 192;
const FRAME_ZOOM_MIN = 0.5;
const FRAME_ZOOM_MAX = 4;
const FRAME_ZOOM_STEP = 0.25;
const VIDEO_FPS_MIN = 0.5;
const VIDEO_FPS_MAX = 3;
const VIDEO_FPS_STEP = 0.25;

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
  const galleryDragStartRef = useRef<number | null>(null);
  const galleryDragSamplesRef = useRef<Array<{ x: number; t: number }>>([]);
  const galleryMomentumAnimRef = useRef<number | null>(null);
  const galleryPositionRef = useRef(0);
  const galleryVelocityRef = useRef(0);
  const galleryLastTickRef = useRef<number | null>(null);

  // Shared frame zoom for gallery + slideshow (does not affect page layout elsewhere)
  const [frameZoom, setFrameZoom] = useState(1.5);

  // Video / slideshow mode state
  const [videoModeIndex, setVideoModeIndex] = useState(0);
  const [videoModePlaying, setVideoModePlaying] = useState(false);
  const [videoModeFps, setVideoModeFps] = useState(1);
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
  const frameDisplayHeight = Math.round(BASE_FRAME_HEIGHT_PX * frameZoom);

  const stopGalleryMomentum = useCallback(() => {
    if (galleryMomentumAnimRef.current != null) {
      cancelAnimationFrame(galleryMomentumAnimRef.current);
      galleryMomentumAnimRef.current = null;
    }
    galleryLastTickRef.current = null;
    galleryVelocityRef.current = 0;
  }, []);

  const setGalleryIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(frames.length - 1, index));
      galleryPositionRef.current = clamped;
      setCurrentGalleryIndex(clamped);
    },
    [frames.length],
  );

  const startGalleryMomentum = useCallback(
    (initialVelocityFramesPerSec: number) => {
      if (frames.length <= 1) return;
      stopGalleryMomentum();
      galleryVelocityRef.current = initialVelocityFramesPerSec;
      galleryPositionRef.current = Math.min(
        frames.length - 1,
        Math.max(0, currentGalleryIndex),
      );

      const tick = (now: number) => {
        const last = galleryLastTickRef.current ?? now;
        galleryLastTickRef.current = now;
        const dt = Math.min(0.05, (now - last) / 1000);

        galleryPositionRef.current += galleryVelocityRef.current * dt;
        galleryVelocityRef.current *= 0.9;

        if (galleryPositionRef.current < 0) {
          galleryPositionRef.current = 0;
          galleryVelocityRef.current = 0;
        } else if (galleryPositionRef.current > frames.length - 1) {
          galleryPositionRef.current = frames.length - 1;
          galleryVelocityRef.current = 0;
        }

        setCurrentGalleryIndex(Math.round(galleryPositionRef.current));

        if (Math.abs(galleryVelocityRef.current) > 0.08) {
          galleryMomentumAnimRef.current = requestAnimationFrame(tick);
        } else {
          galleryMomentumAnimRef.current = null;
          galleryVelocityRef.current = 0;
          galleryPositionRef.current = Math.round(galleryPositionRef.current);
        }
      };

      galleryMomentumAnimRef.current = requestAnimationFrame(tick);
    },
    [currentGalleryIndex, frames.length, stopGalleryMomentum],
  );

  const finishGalleryDrag = useCallback(() => {
    const samples = galleryDragSamplesRef.current;
    galleryDragStartRef.current = null;
    galleryDragSamplesRef.current = [];

    if (samples.length < 2 || frames.length <= 1) return;

    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const dx = last.x - first.x;
    const dt = Math.max(last.t - first.t, 16);
    const pxPerMs = dx / dt;
    const framesPerSec = -pxPerMs * 0.018;

    if (Math.abs(framesPerSec) < 0.15) {
      if (Math.abs(dx) > 30) {
        setGalleryIndex(currentGalleryIndex + (dx < 0 ? 1 : -1));
      }
      return;
    }

    startGalleryMomentum(
      Math.max(-24, Math.min(24, framesPerSec)),
    );
  }, [currentGalleryIndex, frames.length, setGalleryIndex, startGalleryMomentum]);

  const recordGalleryDrag = useCallback((clientX: number) => {
    const now = performance.now();
    galleryDragSamplesRef.current.push({ x: clientX, t: now });
    if (galleryDragSamplesRef.current.length > 8) {
      galleryDragSamplesRef.current.shift();
    }
  }, []);

  useEffect(() => {
    return () => stopGalleryMomentum();
  }, [stopGalleryMomentum]);

  useEffect(() => {
    galleryPositionRef.current = currentGalleryIndex;
  }, [currentGalleryIndex]);

  // Clamp gallery index to valid range (derived at render, no effect needed)
  const safeGalleryIndex = frames.length > 0
    ? Math.min(currentGalleryIndex, frames.length - 1)
    : 0;
  const safeVideoModeIndex = frames.length > 0
    ? Math.min(videoModeIndex, frames.length - 1)
    : 0;
  const videoModeFrame = frames[safeVideoModeIndex];
  const videoDurationEstimate = formatMs((frames.length / videoModeFps) * 1000);

  // Video slideshow interval — only advances; never side-effects inside the updater
  useEffect(() => {
    if (!videoModePlaying || frameViewMode !== "video") {
      if (videoModeTimerRef.current) {
        clearInterval(videoModeTimerRef.current);
        videoModeTimerRef.current = null;
      }
      return;
    }
    videoModeTimerRef.current = setInterval(() => {
      setVideoModeIndex((prev) =>
        prev >= frames.length - 1 ? prev : prev + 1,
      );
    }, Math.round(1000 / videoModeFps));
    return () => {
      if (videoModeTimerRef.current) clearInterval(videoModeTimerRef.current);
    };
  }, [videoModePlaying, videoModeFps, frameViewMode, frames.length]);

  // End-of-sequence loop — pauses 1 s then resets index; interval self-clamps while waiting.
  // No synchronous setState: timeout cleanup handles unmount safely.
  useEffect(() => {
    if (!videoModePlaying || frameViewMode !== "video" || frames.length <= 1)
      return;
    if (videoModeIndex < frames.length - 1) return;
    const tid = setTimeout(() => {
      setVideoModeIndex(0);
    }, 1000);
    return () => clearTimeout(tid);
  }, [videoModeIndex, videoModePlaying, frameViewMode, frames.length]);

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

  const { job, parsedRows, editCount, deleteCount, addCount, sameFileResubmits, groupPasses } =
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
        <div>
          <p className="text-xs text-[#8b949e]">{tDetail("qualityBucket")}</p>
          <div className="flex items-center gap-1.5">
            <QualityBadge bucket={job.qualityBucket} />
            {job.qualityScore != null ? (
              <span className="text-xs text-[#8b949e]">
                ({(job.qualityScore * 100).toFixed(0)}%)
              </span>
            ) : null}
            {!job.qualityBucket ? (
              <span className="text-sm">—</span>
            ) : null}
          </div>
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

      {groupPasses && groupPasses.length > 1 ? (
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8b949e]">
            {tDetail("siblingPasses")}
          </p>
          <div className="flex flex-wrap gap-2">
            {groupPasses.map((pass) => (
              <Link
                key={pass.id}
                href={`/admin/video-jobs/${pass.id}`}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  pass.id === jobId
                    ? "border-[#58a6ff] text-[#58a6ff]"
                    : "border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                {pass.passKey ?? pass.passRole ?? pass.id.slice(0, 8)}
                {" · "}
                {pass.status}
              </Link>
            ))}
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
            <div className="flex flex-wrap items-center gap-3">
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
              {frameViewMode !== "list" ? (
                <label className="flex min-w-0 flex-1 items-center gap-2 text-xs sm:max-w-xs">
                  <span className="shrink-0 text-[#8b949e]">
                    {tDetail("frameZoom")}
                  </span>
                  <input
                    type="range"
                    min={FRAME_ZOOM_MIN}
                    max={FRAME_ZOOM_MAX}
                    step={FRAME_ZOOM_STEP}
                    value={frameZoom}
                    onChange={(e) => setFrameZoom(Number(e.target.value))}
                    className="min-w-0 flex-1"
                  />
                  <span className="w-10 shrink-0 text-center text-[#e6edf3]">
                    {Math.round(frameZoom * 100)}%
                  </span>
                </label>
              ) : null}
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
                  className="relative mx-auto w-full"
                  style={{
                    height: `${frameDisplayHeight + 72}px`,
                    perspective: "800px",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    stopGalleryMomentum();
                    galleryDragStartRef.current = e.clientX;
                    galleryDragSamplesRef.current = [{ x: e.clientX, t: performance.now() }];
                  }}
                  onMouseMove={(e) => {
                    if (galleryDragStartRef.current == null) return;
                    recordGalleryDrag(e.clientX);
                  }}
                  onMouseUp={() => finishGalleryDrag()}
                  onMouseLeave={() => {
                    if (galleryDragStartRef.current != null) finishGalleryDrag();
                  }}
                  onTouchStart={(e) => {
                    stopGalleryMomentum();
                    const x = e.touches[0]?.clientX ?? null;
                    galleryDragStartRef.current = x;
                    if (x != null) {
                      galleryDragSamplesRef.current = [{ x, t: performance.now() }];
                    }
                  }}
                  onTouchMove={(e) => {
                    if (galleryDragStartRef.current == null) return;
                    const x = e.touches[0]?.clientX;
                    if (x != null) recordGalleryDrag(x);
                  }}
                  onTouchEnd={() => finishGalleryDrag()}
                  onTouchCancel={() => finishGalleryDrag()}
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
                        onClick={() => {
                          stopGalleryMomentum();
                          setGalleryIndex(i);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            stopGalleryMomentum();
                            setGalleryIndex(i);
                          }
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- admin gallery */}
                        <img
                          src={`/api/admin/video-jobs/${jobId}/frames/${frame.frameIndex}`}
                          alt={tDetail("frameThumbnail", {
                            index: frame.frameIndex,
                          })}
                          className="w-auto max-w-none rounded border border-[#30363d] object-contain"
                          style={{
                            height: `${frameDisplayHeight}px`,
                            maxWidth: `${Math.round(frameDisplayHeight * 1.6)}px`,
                          }}
                        />
                        {i === safeGalleryIndex ? (
                          <div className="absolute bottom-0 left-0 right-0 rounded-b border border-t-0 border-[#30363d] bg-[#161b22]/90 px-2 py-1 text-xs text-[#8b949e]">
                            <p className="text-center text-[#e6edf3]">
                              {tDetail("frameLabel", {
                                index: frame.frameIndex,
                              })}
                            </p>
                            <div className="mt-1 flex flex-wrap justify-center gap-1">
                              <span className="rounded bg-[#21262d] px-1.5 py-0.5">
                                {tDetail("uploadMs", {
                                  ms: formatMs(frame.uploadMs),
                                })}
                              </span>
                              <span className="rounded bg-[#21262d] px-1.5 py-0.5">
                                {tDetail("extractMs", {
                                  ms: formatMs(frame.extractMs),
                                })}
                              </span>
                              <span className="rounded bg-[#21262d] px-1.5 py-0.5">
                                {tDetail("entryCount", {
                                  count: frame.ocrEntryCount ?? 0,
                                })}
                              </span>
                              {frame.ocrError ? (
                                <span className="rounded bg-red-950/50 px-1.5 py-0.5 text-red-300">
                                  {frame.ocrError}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      stopGalleryMomentum();
                      setGalleryIndex(safeGalleryIndex - 1);
                    }}
                    disabled={safeGalleryIndex === 0}
                    className="rounded px-3 py-1 text-sm text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30"
                  >
                    ← {tDetail("galleryPrev")}
                  </button>
                  <span className="text-xs text-[#8b949e]">
                    {safeGalleryIndex + 1} / {frames.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      stopGalleryMomentum();
                      setGalleryIndex(safeGalleryIndex + 1);
                    }}
                    disabled={safeGalleryIndex === frames.length - 1}
                    className="rounded px-3 py-1 text-sm text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30"
                  >
                    {tDetail("galleryNext")} →
                  </button>
                </div>
              </div>
            ) : null}

            {/* Video / slideshow mode */}
            {frameViewMode === "video" ? (
              <div className="space-y-4">
                <div className="relative mx-auto w-full max-w-none">
                  {videoModeFrame ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin slideshow
                    <img
                      src={`/api/admin/video-jobs/${jobId}/frames/${videoModeFrame.frameIndex}`}
                      alt={tDetail("frameThumbnail", {
                        index: videoModeFrame.frameIndex,
                      })}
                      className="mx-auto w-auto max-w-full rounded-lg border border-[#30363d] object-contain"
                      style={{
                        height: `${frameDisplayHeight}px`,
                        maxHeight: "85vh",
                        maxWidth: "100%",
                      }}
                    />
                  ) : null}
                  {videoModeFrame ? (
                    <div className="mt-2 space-y-1 text-center text-xs text-[#8b949e]">
                      <p className="text-[#e6edf3]">
                        {tDetail("frameLabel", {
                          index: videoModeFrame.frameIndex,
                        })}
                      </p>
                      <div className="flex flex-wrap justify-center gap-1">
                        <span className="rounded bg-[#21262d] px-1.5 py-0.5">
                          {tDetail("uploadMs", {
                            ms: formatMs(videoModeFrame.uploadMs),
                          })}
                        </span>
                        <span className="rounded bg-[#21262d] px-1.5 py-0.5">
                          {tDetail("extractMs", {
                            ms: formatMs(videoModeFrame.extractMs),
                          })}
                        </span>
                        <span className="rounded bg-[#21262d] px-1.5 py-0.5">
                          {tDetail("entryCount", {
                            count: videoModeFrame.ocrEntryCount ?? 0,
                          })}
                        </span>
                        {videoModeFrame.ocrError ? (
                          <span className="rounded bg-red-950/50 px-1.5 py-0.5 text-red-300">
                            {videoModeFrame.ocrError}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
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
                  <label className="flex flex-wrap items-center justify-center gap-3 text-sm">
                    <span className="text-[#8b949e]">
                      {tDetail("videoFps")}
                    </span>
                    <input
                      type="range"
                      min={VIDEO_FPS_MIN}
                      max={VIDEO_FPS_MAX}
                      step={VIDEO_FPS_STEP}
                      value={videoModeFps}
                      onChange={(e) => setVideoModeFps(Number(e.target.value))}
                      className="w-40"
                    />
                    <span className="w-10 text-center text-[#e6edf3]">
                      {videoModeFps.toFixed(2).replace(/\.?0+$/, "")}
                    </span>
                    <span className="text-xs text-[#8b949e]">
                      {tDetail("videoDuration", {
                        duration: videoDurationEstimate,
                      })}
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={frames.length - 1}
                      value={safeVideoModeIndex}
                      onChange={(e) => {
                        setVideoModeIndex(Number(e.target.value));
                        setVideoModePlaying(false);
                      }}
                      className="w-64"
                    />
                    <span className="text-xs text-[#8b949e]">
                      {safeVideoModeIndex + 1} / {frames.length}
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
