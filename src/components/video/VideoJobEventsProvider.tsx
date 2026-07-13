"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Link, usePathname } from "@/i18n/navigation";
import type { VideoJobStatusEvent } from "@/lib/events/video-jobs-types";
import {
  deriveApprovedAtFromLiveUpdate,
  deriveRejectedAt,
  shouldShowRecentUploadJob,
} from "@/lib/video/recent-upload-jobs.shared";
import {
  isActiveVideoJobStatus,
  isPendingApprovalStatus,
  isReviewReadyStatus,
} from "@/lib/events/video-jobs-types";

type VideoJobBanner = {
  jobId: string;
  kind: "review" | "failed";
  fileName: string | null;
  matchedCount?: number | null;
  rowCount?: number | null;
};

type VideoJobEventsContextValue = {
  jobsById: Record<string, VideoJobStatusEvent>;
  connected: boolean;
  banners: VideoJobBanner[];
  dismissBanner: (jobId: string) => void;
};

const VideoJobEventsContext = createContext<VideoJobEventsContextValue | null>(
  null,
);

function mergeJobEvent(
  current: VideoJobStatusEvent | undefined,
  next: VideoJobStatusEvent,
): VideoJobStatusEvent {
  if (!current) {
    return next;
  }
  if (
    new Date(next.updatedAt).getTime() < new Date(current.updatedAt).getTime()
  ) {
    return current;
  }
  return { ...current, ...next };
}

function reviewPathForJob(jobId: string): string {
  return `/tools/video-upload/${jobId}/review`;
}

function VideoJobCompletionBanners({
  banners,
  onDismiss,
}: {
  banners: VideoJobBanner[];
  onDismiss: (jobId: string) => void;
}) {
  const t = useTranslations("videoJobs");

  if (banners.length === 0) {
    return null;
  }

  return (
    <div className="space-y-0 border-b border-hq-border">
      {banners.map((banner) => {
        const isFailed = banner.kind === "failed";
        const fileLabel = banner.fileName ?? banner.jobId;

        return (
          <div
            key={`${banner.jobId}:${banner.kind}`}
            className={`flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm ${
              isFailed
                ? "border-hq-danger/40 bg-[#f8514915] text-hq-danger"
                : "border-hq-success/40 bg-[#23863615] text-hq-fg"
            }`}
          >
            <p>
              {isFailed
                ? t("failedBanner", { fileName: fileLabel })
                : banner.rowCount != null && banner.matchedCount != null
                  ? t("readyBannerWithCounts", {
                      fileName: fileLabel,
                      matched: banner.matchedCount,
                      total: banner.rowCount,
                    })
                  : t("readyBanner", { fileName: fileLabel })}
            </p>
            <div className="flex items-center gap-3">
              {isFailed ? (
                <Link
                  href="/tools/video-upload"
                  className="font-medium text-hq-accent hover:underline"
                >
                  {t("failedBannerCta")}
                </Link>
              ) : (
                <Link
                  href={reviewPathForJob(banner.jobId)}
                  className="font-medium text-hq-green hover:underline"
                >
                  {t("readyBannerCta")}
                </Link>
              )}
              <button
                type="button"
                onClick={() => onDismiss(banner.jobId)}
                className="text-hq-fg-muted hover:text-hq-fg"
              >
                {t("dismiss")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function VideoJobStatusBanners() {
  const { banners, dismissBanner } = useVideoJobEvents();
  return (
    <VideoJobCompletionBanners banners={banners} onDismiss={dismissBanner} />
  );
}

export function VideoJobEventsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  const [jobsById, setJobsById] = useState<Record<string, VideoJobStatusEvent>>(
    {},
  );
  const [connected, setConnected] = useState(false);
  const [banners, setBanners] = useState<VideoJobBanner[]>([]);
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const dismissedRef = useRef(dismissedJobIds);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    dismissedRef.current = dismissedJobIds;
  }, [dismissedJobIds]);

  const pushBanner = useCallback((event: VideoJobStatusEvent) => {
    if (event.status !== "review" && event.status !== "failed") {
      return;
    }
    if (dismissedRef.current.has(event.jobId)) {
      return;
    }
    if (pathnameRef.current === reviewPathForJob(event.jobId)) {
      return;
    }

    const kind = event.status === "failed" ? "failed" : "review";
    setBanners((prev) => {
      const key = `${event.jobId}:${kind}`;
      if (prev.some((banner) => `${banner.jobId}:${banner.kind}` === key)) {
        return prev;
      }
      return [
        ...prev,
        {
          jobId: event.jobId,
          kind,
          fileName: event.fileName,
          matchedCount: event.matchedCount,
          rowCount: event.rowCount,
        },
      ];
    });
  }, []);

  const applyJobEvent = useCallback(
    (event: VideoJobStatusEvent, options?: { notify?: boolean }) => {
      setJobsById((prev) => ({
        ...prev,
        [event.jobId]: mergeJobEvent(prev[event.jobId], event),
      }));
      if (options?.notify) {
        pushBanner(event);
      }
    },
    [pushBanner],
  );

  useEffect(() => {
    let source: EventSource | null = null;
    let retryMs = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;
    let plannedReconnect = false;

    function scheduleConnect(delayMs: number) {
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      retryTimer = setTimeout(connect, delayMs);
    }

    function connect() {
      source = new EventSource("/api/events/video-jobs");

      source.addEventListener("snapshot", (message) => {
        const data = JSON.parse(message.data) as { jobs?: VideoJobStatusEvent[] };
        if (!data.jobs?.length) {
          return;
        }
        setJobsById((prev) => {
          const next = { ...prev };
          for (const job of data.jobs!) {
            next[job.jobId] = mergeJobEvent(next[job.jobId], job);
          }
          return next;
        });
      });

      source.addEventListener("job", (message) => {
        const event = JSON.parse(message.data) as VideoJobStatusEvent;
        applyJobEvent(event, { notify: true });
      });

      source.addEventListener("reconnect", () => {
        plannedReconnect = true;
        setConnected(false);
        source?.close();
        source = null;
        if (!unmounted) {
          scheduleConnect(50);
        }
      });

      source.addEventListener("open", () => {
        retryMs = 1_000;
        setConnected(true);
      });

      source.onerror = () => {
        if (plannedReconnect) {
          plannedReconnect = false;
          return;
        }
        setConnected(false);
        source?.close();
        source = null;
        if (!unmounted) {
          scheduleConnect(retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      source?.close();
    };
  }, [applyJobEvent]);

  const dismissBanner = useCallback((jobId: string) => {
    setDismissedJobIds((prev) => new Set(prev).add(jobId));
    setBanners((prev) => prev.filter((banner) => banner.jobId !== jobId));
  }, []);

  const visibleBanners = useMemo(
    () => banners.filter((banner) => !dismissedJobIds.has(banner.jobId)),
    [banners, dismissedJobIds],
  );

  const value = useMemo(
    () => ({
      jobsById,
      connected,
      banners: visibleBanners,
      dismissBanner,
    }),
    [connected, dismissBanner, jobsById, visibleBanners],
  );

  return (
    <VideoJobEventsContext.Provider value={value}>
      {children}
    </VideoJobEventsContext.Provider>
  );
}

export function useVideoJobEvents() {
  const context = useContext(VideoJobEventsContext);
  if (!context) {
    throw new Error(
      "useVideoJobEvents must be used within VideoJobEventsProvider",
    );
  }
  return context;
}

export function useVideoJob(jobId: string): VideoJobStatusEvent | null {
  const { jobsById } = useVideoJobEvents();
  return jobsById[jobId] ?? null;
}

export function useMergedVideoJobs<T extends { id: string; status: string }>(
  initialJobs: T[],
): T[] {
  const { jobsById } = useVideoJobEvents();

  return useMemo(() => {
    const keepJob = (job: T) =>
      shouldShowRecentUploadJob({
        status: job.status,
        approvedAt:
          "approvedAt" in job
            ? (job as { approvedAt?: string | null }).approvedAt
            : null,
      });

    const merged = initialJobs
      .filter(keepJob)
      .map((job) => {
      const live = jobsById[job.id];
      if (!live) {
        return job;
      }
      const nextStatus = live.status;
      const existingApprovedAt =
        "approvedAt" in job
          ? (job as { approvedAt?: string | null }).approvedAt
          : null;
      const approvedAt = deriveApprovedAtFromLiveUpdate({
        previousStatus: job.status,
        nextStatus,
        existingApprovedAt,
        liveUpdatedAt: live.updatedAt,
      });
      const rejectedAt = deriveRejectedAt({
        status: nextStatus,
        approvedAt: approvedAt ?? existingApprovedAt ?? null,
        updatedAt: live.updatedAt,
      });
      return {
        ...job,
        status: nextStatus,
        fileName: live.fileName ?? ("fileName" in job ? job.fileName : undefined),
        scoreTarget:
          live.scoreTarget ??
          ("scoreTarget" in job ? job.scoreTarget : undefined),
        frameCount:
          live.frameCount ?? ("frameCount" in job ? job.frameCount : null),
        uploadedFrameCount:
          live.uploadedFrameCount ??
          ("uploadedFrameCount" in job ? job.uploadedFrameCount : null),
        errorMessage:
          live.errorMessage ??
          ("errorMessage" in job ? job.errorMessage : null),
        ...(approvedAt !== undefined ? { approvedAt } : {}),
        ...(rejectedAt !== undefined ? { rejectedAt } : {}),
      } as T;
    })
      .filter(keepJob);

    for (const live of Object.values(jobsById)) {
      if (merged.some((job) => job.id === live.jobId)) {
        continue;
      }
      if (
        !isActiveVideoJobStatus(live.status) &&
        !isPendingApprovalStatus(live.status) &&
        !isReviewReadyStatus(live.status) &&
        live.status !== "failed"
      ) {
        continue;
      }
      merged.unshift({
        id: live.jobId,
        status: live.status,
        fileName: live.fileName,
        fileSizeBytes: null,
        category: live.scoreTarget,
        scoreTarget: live.scoreTarget,
        frameCount: live.frameCount ?? null,
        uploadedFrameCount: live.uploadedFrameCount ?? null,
        parseSessionId: null,
        errorMessage: live.errorMessage ?? null,
        createdAt: live.updatedAt,
      } as unknown as T);
    }

    return merged;
  }, [initialJobs, jobsById]);
}
