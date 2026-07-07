"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { VideoJobDiagnosticsPanel } from "@/components/admin/VideoJobDiagnosticsPanel";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Link } from "@/i18n/navigation";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import {
  isRosterTesseractEvalComparison,
  type RosterTesseractEvalComparison,
} from "@/lib/video/compare-roster-ocr-quality";
import {
  adminVideoJobDetailHref,
  adminVideoJobsListHref,
  parseAdminVideoJobsListFilters,
} from "@/lib/video/admin-video-jobs-query.shared";
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
  /** Display name or email of the HQ user who uploaded the video. */
  uploadedBy?: string | null;
  rating?: string | null;
  ratingReason?: string | null;
  qualityBucket?: string | null;
  qualityScore?: number | null;
  passKey?: string | null;
  passRole?: string | null;
  extractionConfigJson?: unknown;
};

/** Returns the total OCR phase ms from whatever engine ran (ashed / native / mock). */
function resolveOcrTotalMs(
  phases: VideoProcessTimings["phases"] | undefined,
): number | undefined {
  if (!phases) return undefined;
  const candidates = [
    "ashed.ocr_total",
    "ashed.roster_ocr_total",
    "tesseract.roster_ocr_total",
    "mock.ocr_total",
    "mock.roster_ocr_total",
  ] as const;
  for (const key of candidates) {
    const v = phases[key as keyof typeof phases];
    if (typeof v === "number") return v;
  }
  return undefined;
}

const QUALITY_BUCKET_COLORS: Record<string, string> = {
  perfect: "bg-[#3fb95020] text-hq-green border-hq-green",
  q1: "bg-[#3fb95010] text-hq-green border-hq-green",
  q2: "bg-[#d2992210] text-[#d29922] border-[#d29922]",
  q3: "bg-[#d2992210] text-[#d29922] border-[#d29922]",
  q4: "bg-[#f8514910] text-hq-danger border-hq-danger",
  q5: "bg-[#f8514910] text-hq-danger border-hq-danger",
  dropped_the_ball: "bg-[#f8514920] text-hq-danger border-hq-danger",
};

function QualityBadge({ bucket }: { bucket: string | null | undefined }) {
  if (!bucket) return null;
  const cls =
    QUALITY_BUCKET_COLORS[bucket] ??
    "bg-hq-surface-muted text-hq-fg-muted border-hq-border";
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
  schoolingTuitionAnswer: string | null;
};

type GroupPass = {
  id: string;
  passKey: string | null;
  passRole: string | null;
  status: string;
};

type GroupInfo = {
  selectedJobId: string | null;
  accuracyJobId: string | null;
  recommendedJobId: string | null;
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
  groupInfo?: GroupInfo | null;
  rosterTesseractEval?: unknown;
};

type TabId = "frames" | "parse" | "timings" | "diagnostics";
type FrameViewMode = "list" | "gallery" | "video";

const BASE_FRAME_HEIGHT_PX = 192;
/** Internal scale at 100% display (formerly shown as 300% before zoom rebaseline). */
const FRAME_ZOOM_BASELINE = 3;
const FRAME_DISPLAY_ZOOM_MIN = 15;
const FRAME_DISPLAY_ZOOM_MAX = 150;
const FRAME_DISPLAY_ZOOM_STEP = 5;
const FRAME_ZOOM_STORAGE_KEY = "admin-video-job-frame-zoom-percent";
const FRAME_VIEW_MODE_STORAGE_KEY = "admin-video-job-frame-view-mode";
const FRAME_VIEW_MODES: FrameViewMode[] = ["list", "gallery", "video"];
/** Gallery stage uses 80vh; drag sensitivity scales with viewport height. */
const GALLERY_STAGE_VH_RATIO = 0.8;
/** Horizontal drag (px) that advances one frame in the carousel. */
const GALLERY_PIXELS_PER_FRAME_RATIO = 0.42;
const GALLERY_MOMENTUM_FRICTION = 0.94;
const GALLERY_MOMENTUM_MIN_VELOCITY = 0.04;
const GALLERY_SNAP_DURATION_MS = 220;
const VIDEO_FPS_MIN = 0.5;
const VIDEO_FPS_MAX = 3;
const VIDEO_FPS_STEP = 0.25;

function clampFrameZoomPercent(percent: number): number {
  return Math.min(
    FRAME_DISPLAY_ZOOM_MAX,
    Math.max(FRAME_DISPLAY_ZOOM_MIN, percent),
  );
}

function readStoredFrameZoomPercent(): number {
  if (typeof window === "undefined") return 100;
  try {
    const raw = localStorage.getItem(FRAME_ZOOM_STORAGE_KEY);
    if (raw == null) return 100;
    const percent = Number(raw);
    if (!Number.isFinite(percent)) return 100;
    return clampFrameZoomPercent(percent);
  } catch {
    return 100;
  }
}

function displayZoomPercentToScale(percent: number): number {
  return (percent / 100) * FRAME_ZOOM_BASELINE;
}

function readStoredFrameViewMode(): FrameViewMode {
  if (typeof window === "undefined") return "list";
  try {
    const raw = localStorage.getItem(FRAME_VIEW_MODE_STORAGE_KEY);
    if (raw == null) return "list";
    if ((FRAME_VIEW_MODES as readonly string[]).includes(raw)) {
      return raw as FrameViewMode;
    }
    return "list";
  } catch {
    return "list";
  }
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

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

function formatSchoolingTuitionAnswer(
  survey: SurveyData,
  tSurvey: ReturnType<typeof useTranslations<"videoSurvey">>,
): string {
  if (survey.schoolingTuitionAnswer === "yes") return tSurvey("q3Yes");
  if (survey.schoolingTuitionAnswer === "no") return tSurvey("q3No");
  if (survey.schoolingTuitionAnswer === "idk") return tSurvey("q3Idk");
  if (survey.aboveAverageScroll === true) return tSurvey("q3Yes");
  if (survey.aboveAverageScroll === false) return tSurvey("q3No");
  return "—";
}

type FrameLegendProps = {
  frame: FrameRow;
  tDetail: ReturnType<typeof useTranslations<"admin.videoJobDetailPage">>;
};

function GalleryFrameLegend({ frame, tDetail }: FrameLegendProps) {
  return (
    <div className="min-h-[4.5rem] shrink-0 border-t border-hq-border bg-hq-surface px-4 py-3">
      <p className="mb-2 text-xs font-medium text-hq-fg-muted">
        {tDetail("frameLabel", { index: frame.frameIndex })}
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-hq-surface-muted px-2.5 py-1 text-hq-fg">
          {tDetail("uploadMs", { ms: formatMs(frame.uploadMs) })}
        </span>
        <span className="rounded-full bg-hq-surface-muted px-2.5 py-1 text-hq-fg">
          {tDetail("extractMs", { ms: formatMs(frame.extractMs) })}
        </span>
        <span className="rounded-full bg-hq-surface-muted px-2.5 py-1 text-hq-fg">
          {tDetail("entryCount", { count: frame.ocrEntryCount ?? 0 })}
        </span>
        {frame.ocrError ? (
          <span className="rounded-full border border-hq-danger/30 bg-hq-danger/10 px-2.5 py-1 text-hq-danger">
            {frame.ocrError}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function estimateGalleryReleaseVelocityPxPerMs(
  samples: Array<{ x: number; t: number }>,
): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  const windowMs = 120;
  let start = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    const sample = samples[i]!;
    if (last.t - sample.t <= windowMs) {
      start = sample;
    } else {
      break;
    }
  }
  const dt = Math.max(last.t - start.t, 8);
  return (last.x - start.x) / dt;
}

export function AdminVideoJobDetailView({ jobId }: { jobId: string }) {
  const t = useTranslations("admin");
  const tDetail = useTranslations("admin.videoJobDetailPage");
  const tSurvey = useTranslations("videoSurvey");
  const searchParams = useSearchParams();
  const listFilters = useMemo(
    () => parseAdminVideoJobsListFilters(searchParams),
    [searchParams],
  );
  const listHref = useMemo(
    () => adminVideoJobsListHref(listFilters),
    [listFilters],
  );
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("frames");
  const [expandedFrames, setExpandedFrames] = useState<Set<number>>(new Set());

  // Frame view mode
  const [frameViewMode, setFrameViewMode] = useState<FrameViewMode>(() =>
    readStoredFrameViewMode(),
  );

  const persistFrameViewMode = useCallback((mode: FrameViewMode) => {
    setFrameViewMode(mode);
    try {
      localStorage.setItem(FRAME_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore quota / private mode
    }
  }, []);

  // Gallery mode state — continuous position (frame units) for drag + momentum
  const [galleryPosition, setGalleryPosition] = useState(0);
  const [galleryInteracting, setGalleryInteracting] = useState(false);
  const galleryDragAnchorXRef = useRef<number | null>(null);
  const galleryDragAnchorPositionRef = useRef(0);
  const galleryDragSamplesRef = useRef<Array<{ x: number; t: number }>>([]);
  const galleryMomentumAnimRef = useRef<number | null>(null);
  const gallerySnapAnimRef = useRef<number | null>(null);
  const galleryPositionRef = useRef(0);
  const galleryVelocityRef = useRef(0);
  const galleryLastTickRef = useRef<number | null>(null);

  // Shared frame zoom for gallery + slideshow (does not affect page layout elsewhere)
  const [frameZoomPercent, setFrameZoomPercent] = useState(() =>
    readStoredFrameZoomPercent(),
  );

  const persistFrameZoomPercent = useCallback((percent: number) => {
    const clamped = clampFrameZoomPercent(percent);
    setFrameZoomPercent(clamped);
    try {
      localStorage.setItem(FRAME_ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      // ignore quota / private mode
    }
  }, []);

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
  const frameZoom = displayZoomPercentToScale(frameZoomPercent);
  const frameDisplayHeight = Math.round(BASE_FRAME_HEIGHT_PX * frameZoom);
  const galleryStageHeightPx =
    typeof window !== "undefined"
      ? Math.round(window.innerHeight * GALLERY_STAGE_VH_RATIO)
      : 640;
  const galleryPixelsPerFrame = Math.max(
    72,
    galleryStageHeightPx * GALLERY_PIXELS_PER_FRAME_RATIO,
  );

  const stopGallerySnap = useCallback(() => {
    if (gallerySnapAnimRef.current != null) {
      cancelAnimationFrame(gallerySnapAnimRef.current);
      gallerySnapAnimRef.current = null;
    }
  }, []);

  const stopGalleryMomentum = useCallback(() => {
    if (galleryMomentumAnimRef.current != null) {
      cancelAnimationFrame(galleryMomentumAnimRef.current);
      galleryMomentumAnimRef.current = null;
    }
    galleryLastTickRef.current = null;
    galleryVelocityRef.current = 0;
  }, []);

  const setGalleryPositionClamped = useCallback(
    (position: number) => {
      const max = Math.max(0, frames.length - 1);
      const clamped = Math.max(0, Math.min(max, position));
      galleryPositionRef.current = clamped;
      setGalleryPosition(clamped);
    },
    [frames.length],
  );

  const snapGalleryToNearest = useCallback(() => {
    if (frames.length <= 1) return;
    stopGalleryMomentum();
    stopGallerySnap();

    const target = Math.round(galleryPositionRef.current);
    const start = galleryPositionRef.current;
    if (Math.abs(target - start) < 0.001) {
      setGalleryPositionClamped(target);
      setGalleryInteracting(false);
      return;
    }

    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / GALLERY_SNAP_DURATION_MS);
      const eased = 1 - (1 - t) ** 3;
      const next = start + (target - start) * eased;
      galleryPositionRef.current = next;
      setGalleryPosition(next);
      if (t < 1) {
        gallerySnapAnimRef.current = requestAnimationFrame(tick);
      } else {
        gallerySnapAnimRef.current = null;
        setGalleryPositionClamped(target);
        setGalleryInteracting(false);
      }
    };
    gallerySnapAnimRef.current = requestAnimationFrame(tick);
  }, [
    frames.length,
    setGalleryPositionClamped,
    stopGalleryMomentum,
    stopGallerySnap,
  ]);

  const setGalleryIndex = useCallback(
    (index: number) => {
      stopGalleryMomentum();
      stopGallerySnap();
      setGalleryInteracting(false);
      setGalleryPositionClamped(index);
    },
    [setGalleryPositionClamped, stopGalleryMomentum, stopGallerySnap],
  );

  const startGalleryMomentum = useCallback(
    (initialVelocityFramesPerSec: number) => {
      if (frames.length <= 1) return;
      stopGalleryMomentum();
      stopGallerySnap();
      setGalleryInteracting(true);
      galleryVelocityRef.current = initialVelocityFramesPerSec;
      galleryLastTickRef.current = null;

      const tick = (now: number) => {
        const last = galleryLastTickRef.current ?? now;
        galleryLastTickRef.current = now;
        const dt = Math.min(0.05, (now - last) / 1000);

        galleryPositionRef.current += galleryVelocityRef.current * dt;
        galleryVelocityRef.current *= GALLERY_MOMENTUM_FRICTION ** (dt * 60);

        const max = frames.length - 1;
        if (galleryPositionRef.current < 0) {
          galleryPositionRef.current = 0;
          galleryVelocityRef.current = 0;
        } else if (galleryPositionRef.current > max) {
          galleryPositionRef.current = max;
          galleryVelocityRef.current = 0;
        }

        setGalleryPosition(galleryPositionRef.current);

        if (Math.abs(galleryVelocityRef.current) > GALLERY_MOMENTUM_MIN_VELOCITY) {
          galleryMomentumAnimRef.current = requestAnimationFrame(tick);
        } else {
          galleryMomentumAnimRef.current = null;
          galleryVelocityRef.current = 0;
          snapGalleryToNearest();
        }
      };

      galleryMomentumAnimRef.current = requestAnimationFrame(tick);
    },
    [frames.length, snapGalleryToNearest, stopGalleryMomentum, stopGallerySnap],
  );

  const finishGalleryDrag = useCallback(() => {
    const samples = galleryDragSamplesRef.current;
    galleryDragAnchorXRef.current = null;
    galleryDragSamplesRef.current = [];

    if (frames.length <= 1) {
      setGalleryInteracting(false);
      return;
    }

    const pxPerMs = estimateGalleryReleaseVelocityPxPerMs(samples);
    const framesPerSec = (-pxPerMs * 1000) / galleryPixelsPerFrame;

    if (Math.abs(framesPerSec) < 0.25) {
      snapGalleryToNearest();
      return;
    }

    startGalleryMomentum(Math.max(-36, Math.min(36, framesPerSec)));
  }, [
    frames.length,
    galleryPixelsPerFrame,
    snapGalleryToNearest,
    startGalleryMomentum,
  ]);

  const recordGalleryDrag = useCallback(
    (clientX: number) => {
      const anchorX = galleryDragAnchorXRef.current;
      if (anchorX == null) return;

      const now = performance.now();
      galleryDragSamplesRef.current.push({ x: clientX, t: now });
      if (galleryDragSamplesRef.current.length > 12) {
        galleryDragSamplesRef.current.shift();
      }

      const deltaFrames =
        -(clientX - anchorX) / galleryPixelsPerFrame;
      const next =
        galleryDragAnchorPositionRef.current + deltaFrames;
      setGalleryPositionClamped(next);
    },
    [galleryPixelsPerFrame, setGalleryPositionClamped],
  );

  const beginGalleryDrag = useCallback(
    (clientX: number) => {
      stopGalleryMomentum();
      stopGallerySnap();
      setGalleryInteracting(true);
      galleryDragAnchorXRef.current = clientX;
      galleryDragAnchorPositionRef.current = galleryPositionRef.current;
      galleryDragSamplesRef.current = [{ x: clientX, t: performance.now() }];
    },
    [stopGalleryMomentum, stopGallerySnap],
  );

  useEffect(() => {
    return () => {
      stopGalleryMomentum();
      stopGallerySnap();
    };
  }, [stopGalleryMomentum, stopGallerySnap]);

  // Clamp gallery index to valid range (derived at render, no effect needed)
  const safeGalleryIndex = frames.length > 0
    ? Math.min(Math.round(galleryPosition), frames.length - 1)
    : 0;
  const galleryFrame = frames[safeGalleryIndex];
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
    return <p className="text-sm text-hq-fg-muted">{tDetail("loading")}</p>;
  }

  const { job, parsedRows, editCount, deleteCount, addCount, sameFileResubmits, groupPasses, groupInfo } =
    data;
  const rosterEval = isRosterTesseractEvalComparison(data.rosterTesseractEval)
    ? (data.rosterTesseractEval as RosterTesseractEvalComparison)
    : null;
  const timings = job.timingsJson;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={listHref}
          className="text-sm text-hq-accent hover:underline"
        >
          {tDetail("backToList")}
        </Link>
        <h1 className="min-w-0 truncate text-lg font-medium text-hq-fg">
          {job.fileName ?? job.id}
        </h1>
      </div>

      <div className="grid gap-3 rounded-xl border border-hq-border bg-hq-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-hq-fg-muted">{t("table.status")}</p>
          <p>{job.status}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("uploadedBy")}</p>
          <p className="wrap-break-word">{job.uploadedBy ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{t("table.target")}</p>
          <p>{job.scoreTarget ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{t("table.time")}</p>
          <p>
            <FormattedDateTime value={job.createdAt} />
          </p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("frameCount")}</p>
          <p>{job.frameCount ?? frames.length}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("totalTime")}</p>
          <p>{formatMs(timings?.totalMs)}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("ocrTime")}</p>
          <p>{formatMs(resolveOcrTotalMs(timings?.phases))}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("frameBytes")}</p>
          <p>{formatBytes(job.totalFileSizeBytes)}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("sameFileResubmits")}</p>
          <p>{sameFileResubmits}</p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("rating")}</p>
          <p>
            {job.rating === "thumbs_up"
              ? "👍"
              : job.rating === "thumbs_down"
                ? `👎${job.ratingReason ? ` · ${job.ratingReason}` : ""}`
                : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-hq-fg-muted">{tDetail("qualityBucket")}</p>
          <div className="flex items-center gap-1.5">
            <QualityBadge bucket={job.qualityBucket} />
            {job.qualityScore != null ? (
              <span className="text-xs text-hq-fg-muted">
                ({(job.qualityScore * 100).toFixed(0)}%)
              </span>
            ) : null}
            {!job.qualityBucket ? (
              <span className="text-sm">—</span>
            ) : null}
          </div>
        </div>
        {(job.passKey ?? job.passRole) ? (
          <div>
            <p className="text-xs text-hq-fg-muted">{tDetail("passKey")}</p>
            <p className="font-mono text-xs">{job.passKey ?? job.passRole}</p>
          </div>
        ) : null}
      </div>

      {data.survey ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
            {tDetail("surveyTitle")}
          </p>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("surveyRowCount")}</p>
              <p>{data.survey.rowCountEstimate ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("surveyScrollStyle")}</p>
              <p>{formatSurveyScrollStyle(data.survey.scrollStyle, tSurvey)}</p>
            </div>
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("surveySchoolingTuition")}</p>
              <p>{formatSchoolingTuitionAnswer(data.survey, tSurvey)}</p>
            </div>
          </div>
        </div>
      ) : null}

      {rosterEval ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
            {tDetail("rosterTesseractEvalTitle")}
          </p>
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("rosterEvalNameRecall")}</p>
              <p>{formatPct(rosterEval.metrics.nameRecall)}</p>
            </div>
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("rosterEvalNamePrecision")}</p>
              <p>{formatPct(rosterEval.metrics.namePrecision)}</p>
            </div>
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("rosterEvalRankAgreement")}</p>
              <p>{formatPct(rosterEval.metrics.rankAgreement)}</p>
            </div>
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("rosterEvalPowerAgreement")}</p>
              <p>{formatPct(rosterEval.metrics.powerAgreement)}</p>
            </div>
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("rosterEvalLevelAgreement")}</p>
              <p>{formatPct(rosterEval.metrics.levelAgreement)}</p>
            </div>
            <div>
              <p className="text-xs text-hq-fg-muted">{tDetail("rosterEvalPassKey")}</p>
              <p className="font-mono text-xs">{rosterEval.tessPassKey ?? "—"}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-hq-fg-muted">
            {tDetail("rosterEvalRowSummary", {
              primary: rosterEval.metrics.primaryRowCount,
              shadow: rosterEval.metrics.shadowRowCount,
              matched: rosterEval.metrics.matchedNameCount,
            })}
          </p>
        </div>
      ) : null}

      {groupPasses && groupPasses.length > 1 ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
            {tDetail("siblingPasses")}
          </p>
          <div className="flex flex-wrap gap-2">
            {groupPasses.map((pass) => {
              const isSelected = groupInfo?.selectedJobId === pass.id;
              const isAccuracy = groupInfo?.accuracyJobId === pass.id;
              const isRecommended = groupInfo?.recommendedJobId === pass.id;
              return (
                <div key={pass.id} className="flex flex-col gap-1">
                  <Link
                    href={adminVideoJobDetailHref(pass.id, listFilters)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      pass.id === jobId
                        ? "border-hq-accent text-hq-accent"
                        : "border-hq-border text-hq-fg-muted hover:text-hq-fg"
                    }`}
                  >
                    {pass.passKey ?? pass.passRole ?? pass.id.slice(0, 8)}
                    {" · "}
                    {pass.status}
                  </Link>
                  {(isSelected || isAccuracy || isRecommended) ? (
                    <div className="flex flex-wrap gap-1">
                      {isSelected ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#3fb95020] text-hq-green">
                          {tDetail("passSelected")}
                        </span>
                      ) : null}
                      {isAccuracy ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#58a6ff20] text-hq-accent">
                          {tDetail("passAccuracyVoted")}
                        </span>
                      ) : null}
                      {isRecommended ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#d2992220] text-[#d29922]">
                          {tDetail("passRecommended")}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {job.errorMessage ? (
        <pre className="overflow-auto rounded-xl border border-hq-danger/40 bg-hq-danger/10 p-3 text-xs text-hq-danger">
          {job.errorMessage}
        </pre>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-hq-border pb-2">
        {(["frames", "parse", "timings", "diagnostics"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === id
                ? "bg-hq-surface-muted text-hq-fg"
                : "text-hq-fg-muted hover:text-hq-fg"
            }`}
          >
            {tDetail(`tabs.${id}`)}
          </button>
        ))}
      </div>

      {tab === "frames" ? (
        frames.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">{tDetail("framesEmpty")}</p>
        ) : (
          <div className="space-y-4">
            {/* View mode switcher */}
            <div className="flex flex-col md:flex-wrap items-center gap-3">
              <div className="flex gap-1">
                {(["list", "gallery", "video"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => persistFrameViewMode(mode)}
                    className={`rounded-lg px-3 py-1.5 text-xs ${
                      frameViewMode === mode
                        ? "bg-hq-surface-muted text-hq-fg"
                        : "text-hq-fg-muted hover:text-hq-fg"
                    }`}
                  >
                    {tDetail(`viewMode.${mode}`)}
                  </button>
                ))}
              </div>
              {frameViewMode !== "list" ? (
                <label className="flex min-w-0 flex-1 items-center gap-2 text-xs sm:max-w-xs">
                  <span className="shrink-0 text-hq-fg-muted">
                    {tDetail("frameZoom")}
                  </span>
                  <input
                    type="range"
                    min={FRAME_DISPLAY_ZOOM_MIN}
                    max={FRAME_DISPLAY_ZOOM_MAX}
                    step={FRAME_DISPLAY_ZOOM_STEP}
                    value={frameZoomPercent}
                    onChange={(e) =>
                      persistFrameZoomPercent(Number(e.target.value))
                    }
                    className="min-w-0 flex-1"
                  />
                  <span className="w-10 shrink-0 text-center text-hq-fg">
                    {frameZoomPercent}%
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
                    className="rounded-xl border border-hq-border bg-hq-surface p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row">
                      {/* eslint-disable-next-line @next/next/no-img-element -- admin-only JPEG from authenticated API route */}
                      <img
                        src={`/api/admin/video-jobs/${jobId}/frames/${frame.frameIndex}`}
                        alt={tDetail("frameThumbnail", {
                          index: frame.frameIndex,
                        })}
                        className="h-24 w-auto max-w-full rounded border border-hq-border object-contain"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-medium text-hq-fg">
                          {tDetail("frameLabel", { index: frame.frameIndex })}
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded bg-hq-surface-muted px-2 py-0.5 text-hq-fg-muted">
                            {tDetail("uploadMs", {
                              ms: formatMs(frame.uploadMs),
                            })}
                          </span>
                          <span className="rounded bg-hq-surface-muted px-2 py-0.5 text-hq-fg-muted">
                            {tDetail("extractMs", {
                              ms: formatMs(frame.extractMs),
                            })}
                          </span>
                          <span className="rounded bg-hq-surface-muted px-2 py-0.5 text-hq-fg-muted">
                            {tDetail("entryCount", {
                              count: frame.ocrEntryCount ?? 0,
                            })}
                          </span>
                          {frame.ocrError ? (
                            <span className="rounded border border-hq-danger/30 bg-hq-danger/10 px-2 py-0.5 text-hq-danger">
                              {frame.ocrError}
                            </span>
                          ) : null}
                        </div>
                        {frame.ocrRawJson != null ? (
                          <button
                            type="button"
                            onClick={() => toggleFrameRaw(frame.frameIndex)}
                            className="text-xs text-hq-accent hover:underline"
                          >
                            {expandedFrames.has(frame.frameIndex)
                              ? tDetail("hideRaw")
                              : tDetail("showRaw")}
                          </button>
                        ) : null}
                        {expandedFrames.has(frame.frameIndex) ? (
                          <pre className="max-h-48 overflow-auto rounded border border-hq-border bg-hq-canvas p-2 text-xs text-hq-fg-muted">
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
              <div className="flex flex-col overflow-hidden rounded-xl border border-hq-border bg-hq-canvas">
                <div
                  className="relative h-[80vh] min-h-0 w-full select-none overflow-hidden"
                >
                  <div
                    className="relative mx-auto h-full w-full"
                    style={{ perspective: "800px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    beginGalleryDrag(e.clientX);
                  }}
                  onMouseMove={(e) => {
                    if (galleryDragAnchorXRef.current == null) return;
                    recordGalleryDrag(e.clientX);
                  }}
                  onMouseUp={() => finishGalleryDrag()}
                  onMouseLeave={() => {
                    if (galleryDragAnchorXRef.current != null) finishGalleryDrag();
                  }}
                  onTouchStart={(e) => {
                    const x = e.touches[0]?.clientX;
                    if (x == null) return;
                    beginGalleryDrag(x);
                  }}
                  onTouchMove={(e) => {
                    if (galleryDragAnchorXRef.current == null) return;
                    const x = e.touches[0]?.clientX;
                    if (x != null) recordGalleryDrag(x);
                  }}
                  onTouchEnd={() => finishGalleryDrag()}
                  onTouchCancel={() => finishGalleryDrag()}
                >
                  {frames.map((frame, i) => {
                    const offset = i - galleryPosition;
                    const visibleRange = 2;
                    if (Math.abs(offset) > visibleRange) return null;
                    const translateX = offset * 60;
                    const rotateY = offset * -30;
                    const scale = 1 - Math.abs(offset) * 0.15;
                    const opacity = 1 - Math.abs(offset) * 0.35;
                    const zIndex = visibleRange - Math.abs(offset);
                    const imageMaxHeight = `calc(80vh * ${scale})`;
                    return (
                      <div
                        key={frame.frameIndex}
                        className={`absolute left-1/2 top-1/2 cursor-pointer ${
                          galleryInteracting
                            ? ""
                            : "transition-transform duration-300"
                        }`}
                        style={{
                          transform: `translate(-50%, -50%) translateX(${translateX}%) rotateY(${rotateY}deg) scale(${scale})`,
                          opacity,
                          zIndex,
                          transformStyle: "preserve-3d",
                        }}
                        onClick={() => {
                          stopGalleryMomentum();
                          stopGallerySnap();
                          setGalleryIndex(i);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            stopGalleryMomentum();
                            stopGallerySnap();
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
                          className="w-auto max-w-full rounded border border-hq-border object-contain"
                          style={{
                            maxHeight: imageMaxHeight,
                            maxWidth: "min(100%, 90vw)",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                </div>
                {galleryFrame ? (
                  <GalleryFrameLegend frame={galleryFrame} tDetail={tDetail} />
                ) : null}
                <div className="flex items-center justify-center gap-3 border-t border-hq-border px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      stopGalleryMomentum();
                      stopGallerySnap();
                      setGalleryIndex(safeGalleryIndex - 1);
                    }}
                    disabled={safeGalleryIndex === 0}
                    className="rounded px-3 py-1 text-sm text-hq-fg-muted hover:text-hq-fg disabled:opacity-30"
                  >
                    ← {tDetail("galleryPrev")}
                  </button>
                  <span className="text-xs text-hq-fg-muted">
                    {safeGalleryIndex + 1} / {frames.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      stopGalleryMomentum();
                      stopGallerySnap();
                      setGalleryIndex(safeGalleryIndex + 1);
                    }}
                    disabled={safeGalleryIndex === frames.length - 1}
                    className="rounded px-3 py-1 text-sm text-hq-fg-muted hover:text-hq-fg disabled:opacity-30"
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
                      className="mx-auto w-auto max-w-full rounded-lg border border-hq-border object-contain"
                      style={{
                        height: `${frameDisplayHeight}px`,
                        maxHeight: "85vh",
                        maxWidth: "100%",
                      }}
                    />
                  ) : null}
                  {videoModeFrame ? (
                    <div className="mt-2 space-y-1 text-center text-xs text-hq-fg-muted">
                      <p className="text-hq-fg">
                        {tDetail("frameLabel", {
                          index: videoModeFrame.frameIndex,
                        })}
                      </p>
                      <div className="flex flex-wrap justify-center gap-1">
                        <span className="rounded bg-hq-surface-muted px-1.5 py-0.5">
                          {tDetail("uploadMs", {
                            ms: formatMs(videoModeFrame.uploadMs),
                          })}
                        </span>
                        <span className="rounded bg-hq-surface-muted px-1.5 py-0.5">
                          {tDetail("extractMs", {
                            ms: formatMs(videoModeFrame.extractMs),
                          })}
                        </span>
                        <span className="rounded bg-hq-surface-muted px-1.5 py-0.5">
                          {tDetail("entryCount", {
                            count: videoModeFrame.ocrEntryCount ?? 0,
                          })}
                        </span>
                        {videoModeFrame.ocrError ? (
                          <span className="rounded border border-hq-danger/30 bg-hq-danger/10 px-1.5 py-0.5 text-hq-danger">
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
                    className="rounded-lg border border-hq-border px-4 py-2 text-sm hover:bg-hq-surface-muted"
                  >
                    {videoModePlaying
                      ? tDetail("videoPause")
                      : tDetail("videoPlay")}
                  </button>
                  <label className="flex flex-wrap items-center justify-center gap-3 text-sm">
                    <span className="text-hq-fg-muted">
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
                    <span className="w-10 text-center text-hq-fg">
                      {videoModeFps.toFixed(2).replace(/\.?0+$/, "")}
                    </span>
                    <span className="text-xs text-hq-fg-muted">
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
                    <span className="text-xs text-hq-fg-muted">
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
          <p className="text-sm text-hq-fg-muted">
            {tDetail("parseSummary", { editCount, deleteCount })}
            {addCount > 0 && (
              <> · {tDetail("addCount", { count: addCount })}</>
            )}
          </p>
          {parsedRows.length === 0 ? (
            <p className="text-sm text-hq-fg-muted">{tDetail("parseEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hq-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-hq-surface text-hq-fg-muted">
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
                      className={`border-t border-hq-border ${
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
                      <td className="px-3 py-2 text-xs text-hq-fg-muted">
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

      {tab === "diagnostics" ? (
        <VideoJobDiagnosticsPanel key={jobId} jobId={jobId} />
      ) : null}

      {tab === "timings" ? (
        !timings ? (
          <p className="text-sm text-hq-fg-muted">{tDetail("timingsEmpty")}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-hq-fg-muted">
              {tDetail("timingsSummary", {
                total: formatMs(timings.totalMs),
                ffmpeg: formatMs(timings.phases?.["ffmpeg.extract"]),
                ocr: formatMs(resolveOcrTotalMs(timings.phases)),
                frames: timings.frameCount,
              })}
            </p>
            <ul className="space-y-2">
              {phaseBars.map(([phase, ms]) => (
                <li key={phase}>
                  <div className="mb-1 flex justify-between text-xs text-hq-fg-muted">
                    <span className="truncate pr-2">{phase}</span>
                    <span className="shrink-0">{formatMs(ms)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-hq-surface-muted">
                    <div
                      className="h-full rounded bg-hq-accent"
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
