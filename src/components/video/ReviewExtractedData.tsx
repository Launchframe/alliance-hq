"use client";

import { useLocale, useTranslations } from "next-intl";
import { Crosshair, LocateFixed, MonitorPlay, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link, useRouter } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { useFeedback } from "@/components/feedback";
import { AppSelect } from "@/components/ui/AppSelect";
import { useAccountTimezone } from "@/components/timezone/TimezoneProvider";
import { useVideoJob } from "@/components/video/VideoJobEventsProvider";
import {
  formatAshedEventOptionLabel,
  formatEventOptionLabel,
  formatHqEventOptionLabel,
  resolveAshedEventDate,
  type AshedEventLike,
} from "@/lib/video/event-option-label";
import { pickAshedEventMatchingDate } from "@/lib/video/ashed-event-provision";
import {
  duplicateMemberRowIds,
  findDuplicateMemberAssignments,
} from "@/lib/video/review-validation";
import { isZeroScoreWarningDisabled } from "@/lib/video/score-targets";
import {
  isValidVsPerformanceRecordedDate,
  listRecentVsPerformanceDates,
  nearestValidVsPerformanceDate,
  vsPerformanceDayMetaForDate,
} from "@/lib/video/vs-recorded-date.shared";
import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";
import { shouldRefetchOnLiveJobStatus } from "@/lib/video/live-job-refresh.shared";
import {
  buildConnectHref,
  stashConnectReturnPath,
} from "@/lib/connect/connect-return-path.shared";
import type { ManualRowPosition } from "@/lib/video/manual-row-position";
import { mergeParsedRowInReviewOrder } from "@/lib/video/parsed-row-review-order";
import { isVideoProcessTimings } from "@/lib/video/pipeline-stats-display";
import { VideoPipelineStatsButton } from "@/components/video/VideoPipelineStatsDialog";
import {
  ReviewVideoPreview,
  type VideoSeekRequest,
  type VideoSeekController,
} from "@/components/video/ReviewVideoPreview";
import { useVideoPreviewLayout } from "@/components/video/useVideoPreviewLayout";
import { useVideoReviewFollowMe } from "@/components/video/useVideoReviewFollowMe";
import {
  previewSeekSecondsForFrame,
  type FrameTimestampMap,
} from "@/lib/video/frame-video-seek";
import { parsePodiumRankInput } from "@/lib/video/podium-rank-input";
import { restoreVideoReviewDraftIfPresent } from "@/lib/video/review-extract-draft.shared";
import {
  isDedupeReport,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";
import { isVideoJobReadyForSubmit } from "@/lib/video/submit-job-ready.shared";
import { useVideoReviewExtractDraft } from "@/components/video/useVideoReviewExtractDraft";
import { accountTodayCalendarDate } from "@/lib/timezone/format";
import { PassComparisonSheet } from "@/components/video/PassComparisonSheet";
import { OcrRatingPrompt, type OcrRatingReason } from "@/components/video/OcrRatingPrompt";
import { RosterAllianceBanner } from "@/components/video/RosterAllianceBanner";
import {
  RosterVideoReviewTable,
  useRosterReviewValidation,
} from "@/components/video/RosterVideoReviewTable";
import {
  DepositSlipVideoReviewTable,
  depositSlipFollowMeCompatible,
  useDepositSlipReviewValidation,
} from "@/components/video/DepositSlipVideoReviewTable";
import type { DepositSlipVisibleSortKey } from "@/lib/banks/deposit-slip-review-visible-rows.shared";
import type { PassComparison } from "@/lib/video/compare-pass-results";
import {
  formatHeroPowerMForStorage,
  parsedRowsToRosterReviewRows,
} from "@/lib/video/roster-video-review.shared";
import type { AshedMember } from "@/lib/video/member-matcher";
import { readPreferredDepositSlipBankId } from "@/lib/banks/deposit-slip-upload-context.shared";
import type { SerializedBank } from "@/lib/banks/types.shared";

type ParsedRow = {
  id: string;
  ocrName: string;
  score: string | null;
  rank: number | null;
  rosterRankRaw?: string | null;
  allianceRank?: number | null;
  allianceRankTitle?: string | null;
  powerLevel?: string | null;
  heroPowerM?: number | null;
  memberLevel?: number | null;
  profession?: string | null;
  edited?: number;
  frameIndex?: number | null;
  memberId: string | null;
  memberName: string | null;
  matchConfidence: number | null;
  matchMethod: string | null;
  scoreConflict: number;
  dedupeClusterId?: string | null;
  dedupeFlag?: boolean;
  deleted: number;
  manuallyAdded?: number;
};

type MemberOption = {
  id: string;
  current_name: string;
  previous_names?: string[];
};

type EventOption = {
  id: string;
  label: string;
};

type ScoreTargetMeta = {
  id: string;
  labelKey: string;
  leaderboardModel: string;
  eventEntity: string | null;
  submitContext: string[];
  boardTypes?: string[];
  maxSubmitRows?: number;
  usesHqEvents: boolean;
  showRankColumn: boolean;
  showTeamSelector: boolean;
  showRosterColumns: boolean;
  showScoreColumn: boolean;
  showDepositSlipColumns: boolean;
  showBankSelector: boolean;
};

type Props = {
  jobId: string;
  viewMode?: "review" | "event";
};

type GroupInfo = {
  group: {
    id: string;
    primaryJobId: string | null;
    selectedJobId: string | null;
    accuracyJobId: string | null;
    comparisonJson: PassComparison | null;
  } | null;
  passes: Array<{
    id: string;
    passKey: string | null;
    passIndex: number | null;
    passRole: string | null;
    status: string;
    frameCount: number | null;
    parseSessionId: string | null;
  }>;
};

function confidenceClass(confidence: number | null): string {
  if (confidence == null || confidence === 0) return "border-hq-danger";
  if (confidence >= 0.9) return "border-hq-green";
  if (confidence >= 0.6) return "border-[#d29922]";
  return "border-hq-danger";
}

function ReviewActionErrorBanner({
  message,
  connectUrl,
  connectLabel,
  onDismiss,
  dismissLabel,
}: {
  message: string;
  connectUrl?: string;
  connectLabel: string;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div
      className="rounded-xl border border-hq-danger/50 bg-[#f8514918] px-4 py-3 shadow-sm"
      role="alert"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium leading-snug text-hq-danger">{message}</p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {connectUrl ? (
            <Link
              href={connectUrl}
              className="rounded-lg border border-hq-danger/60 bg-[#f8514910] px-3 py-1.5 text-sm font-medium text-hq-danger hover:bg-[#f8514925]"
            >
              {connectLabel}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted"
          >
            {dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReviewExtractedData({ jobId, viewMode = "review" }: Props) {
  const router = useRouter();
  const t = useTranslations("videoReview");
  const tQueue = useTranslations("videoQueue");
  const tc = useTranslations("common");
  const tNav = useTranslations("nav");
  const tMembers = useTranslations("members");
  const tBanks = useTranslations("bankManagement");
  const locale = useLocale();
  const { timezoneId } = useAccountTimezone();
  const { showExperienceFeedback } = useFeedback();
  const liveJob = useVideoJob(jobId);

  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [scoreTargetMeta, setScoreTargetMeta] =
    useState<ScoreTargetMeta | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("loading");
  const [allianceId, setAllianceId] = useState<string | null>(null);
  const [ashedAllianceId, setAshedAllianceId] = useState<string | null>(null);
  const [eventId, setEventId] = useState("");
  const [hqEventId, setHqEventId] = useState("");
  const [boardKey, setBoardKey] = useState("");
  const [team, setTeam] = useState<"A" | "B">("A");
  const [recordedDate, setRecordedDate] = useState(() =>
    accountTodayCalendarDate(timezoneId),
  );
  const [stormOverlapWarning, setStormOverlapWarning] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [depositSlipVisibleRowIds, setDepositSlipVisibleRowIds] = useState<
    string[]
  >([]);
  const [depositSlipSortKey, setDepositSlipSortKey] =
    useState<DepositSlipVisibleSortKey>("depositAt");
  const [error, setError] = useState<string | null>(null);
  const [errorConnectUrl, setErrorConnectUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reprocessPending, setReprocessPending] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [groupActionBusy, setGroupActionBusy] = useState<string | null>(null);
  const [addingRowBusy, setAddingRowBusy] = useState<ManualRowPosition | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [timings, setTimings] = useState<VideoProcessTimings | null>(null);
  const [dedupeReport, setDedupeReport] = useState<DedupeReport | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasSourceVideo, setHasSourceVideo] = useState(false);
  const {
    device: previewDevice,
    placement: previewPlacement,
    available: previewPlacements,
    open: previewOpen,
    zoom: previewZoom,
    sideWidthPx: previewSideWidthPx,
    dockHeightPx: previewDockHeightPx,
    setOpen: setPreviewOpen,
    setPlacement: setPreviewPlacement,
    setZoom: setPreviewZoom,
    setSideWidthPx: setPreviewSideWidthPx,
    setDockHeightPx: setPreviewDockHeightPx,
    followMe: previewFollowMe,
    setFollowMe: setPreviewFollowMe,
  } = useVideoPreviewLayout();
  // Never use side placement on phones — prefs/SSR may briefly resolve to side.
  const effectivePreviewPlacement =
    previewPlacement === "side" && previewDevice === "mobile"
      ? "bottom"
      : previewPlacement;
  const previewAutoOpenedForJobRef = useRef<string | null>(null);
  const [previewSeekRequest, setPreviewSeekRequest] =
    useState<VideoSeekRequest>(null);
  const previewSeekControllerRef = useRef<VideoSeekController | null>(null);
  const [frameTimestamps, setFrameTimestamps] = useState<FrameTimestampMap>({});
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [jobRating, setJobRating] = useState<"thumbs_up" | "thumbs_down" | null>(null);
  /** Hold review→event redirect while success/rating UI is on screen. */
  const [holdEventRedirect, setHoldEventRedirect] = useState(false);
  const holdEventRedirectTimeoutRef = useRef<number | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [showComparisonPrompt, setShowComparisonPrompt] = useState(false);
  const [showComparisonSheet, setShowComparisonSheet] = useState(false);
  const [comparisonDismissed, setComparisonDismissed] = useState(false);
  const [rosterMembers, setRosterMembers] = useState<AshedMember[]>([]);
  const [allianceTag, setAllianceTag] = useState<string | null>(null);
  const [allianceName, setAllianceName] = useState<string | null>(null);
  const [allianceStale, setAllianceStale] = useState(false);
  const [rosterQuotaCanSubmit, setRosterQuotaCanSubmit] = useState(false);
  const [banks, setBanks] = useState<SerializedBank[]>([]);
  const [bankId, setBankId] = useState("");
  const rosterMembersHydratedRef = useRef(false);
  const liveJobStatusRef = useRef<string | null>(null);
  const draftDirtyVersionRef = useRef(0);
  const [draftDirtyVersion, setDraftDirtyVersion] = useState(0);
  const isEventView = viewMode === "event";

  const markDraftDirty = useCallback(() => {
    draftDirtyVersionRef.current += 1;
    setDraftDirtyVersion(draftDirtyVersionRef.current);
  }, []);

  const reviewDraftForm = useMemo(
    () => ({
      eventId,
      hqEventId,
      boardKey,
      team,
      recordedDate,
      bankId,
    }),
    [bankId, boardKey, eventId, hqEventId, recordedDate, team],
  );

  const draftEnabled =
    rows.length > 0 && (jobStatus === "review" || jobStatus === "complete");

  const {
    draftRestored,
    setDraftRestored,
    draftSavedAt,
    markAutosaveReady,
    clearDraft,
  } = useVideoReviewExtractDraft({
    jobId,
    viewMode,
    enabled: draftEnabled,
    rows,
    form: reviewDraftForm,
    dirtyVersion: draftDirtyVersion,
  });

  const formattedDraftSavedAt = useMemo(() => {
    if (!draftSavedAt) return "";
    try {
      return formatBrowserLocalDateTime(
        draftSavedAt,
        {
          dateStyle: "medium",
          timeStyle: "short",
        },
        locale,
      );
    } catch {
      return draftSavedAt;
    }
  }, [draftSavedAt, locale]);

  useEffect(() => {
    if (jobStatus === "loading") return;
    if (holdEventRedirect) return;
    const search = window.location.search;
    if (viewMode === "review" && jobStatus === "complete") {
      router.replace(`/tools/video-upload/${jobId}/event${search}`);
      return;
    }
    if (
      viewMode === "event" &&
      jobStatus !== "complete" &&
      jobStatus !== "discarded"
    ) {
      router.replace(`/tools/video-upload/${jobId}/review${search}`);
    }
  }, [holdEventRedirect, jobId, jobStatus, router, viewMode]);

  useEffect(() => {
    return () => {
      if (holdEventRedirectTimeoutRef.current != null) {
        window.clearTimeout(holdEventRedirectTimeoutRef.current);
        holdEventRedirectTimeoutRef.current = null;
      }
    };
  }, []);

  const isVsPerformanceTarget = scoreTargetMeta?.id === "vs-performance";

  const vsSafeRecordedDate = useMemo(() => {
    if (!isVsPerformanceTarget) return recordedDate;
    if (isValidVsPerformanceRecordedDate(recordedDate)) return recordedDate;
    return nearestValidVsPerformanceDate(recordedDate);
  }, [isVsPerformanceTarget, recordedDate]);

  const vsRecordedDateOptions = useMemo(() => {
    if (!isVsPerformanceTarget) return [];
    return listRecentVsPerformanceDates({
      includeDate: vsSafeRecordedDate,
    }).map((date) => {
      const meta = vsPerformanceDayMetaForDate(date);
      const dayName = meta
        ? t(
            `vsDays.${meta.vsDayKey}` as
              | "vsDays.radarTraining"
              | "vsDays.baseExpansion"
              | "vsDays.ageOfScience"
              | "vsDays.trainHeroes"
              | "vsDays.totalMobilization"
              | "vsDays.enemyBuster",
          )
        : date;
      return {
        value: date,
        label: meta
          ? t("vsDayOption", {
              dayNumber: meta.vsDayNumber,
              dayName,
              date,
            })
          : date,
        searchText: `${date} ${dayName}`,
      };
    });
  }, [isVsPerformanceTarget, vsSafeRecordedDate, t]);

  const rematchMembers = useCallback(async () => {
    setRematching(true);
    clearActionError();
    try {
      const res = await fetch(
        `/api/tools/video-upload/${jobId}/rematch-members`,
        { method: "POST" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(data.error ?? tc("uploadFailed"));
        return false;
      }
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("uploadFailed"));
      return false;
    } finally {
      setRematching(false);
    }
  }, [jobId, tc]);

  const loadRef = useRef<
    (options?: { skipRematch?: boolean }) => Promise<void>
  >(() => Promise.resolve());

  const load = useCallback(
    async (options?: { skipRematch?: boolean }) => {
      try {
        const res = await fetch(`/api/tools/video-upload/${jobId}`);
        const data = (await res.json()) as {
          error?: string;
          job?: {
            status: string;
            fileName?: string | null;
            allianceId?: string | null;
            boardKey?: string | null;
            hqEventId?: string | null;
            rating?: string | null;
            timingsJson?: VideoProcessTimings | null;
          };
          hasSourceVideo?: boolean;
          frameTimestamps?: FrameTimestampMap;
          scoreTargetMeta?: ScoreTargetMeta | null;
          alliance?: {
            currentId?: string | null;
            currentTag?: string | null;
            jobTag?: string | null;
            jobName?: string | null;
            ashedAllianceId?: string | null;
            stale?: boolean;
          };
          parseSession?: {
            allianceId?: string | null;
            dedupeReport?: unknown;
          };
          dedupeReport?: unknown;
          rows?: Array<
            ParsedRow & {
              scoreConflict?: number;
              dedupeClusterId?: string | null;
              dedupeFlag?: boolean;
            }
          >;
          members?: AshedMember[];
        };
        if (!res.ok) {
          setJobStatus("load_error");
          setActionError(data.error ?? tc("uploadFailed"));
          return;
        }

        if (
          data.alliance?.stale &&
          !options?.skipRematch &&
          data.job?.status !== "complete" &&
          data.job?.status !== "submitting"
        ) {
          const ok = await rematchMembers();
          if (ok) {
            await loadRef.current({ skipRematch: true });
            return;
          }
        }

        const jobMembers = data.members ?? [];
        setMembers(
          jobMembers.map((member) => ({
            id: member.id,
            current_name: member.current_name,
            previous_names: member.previous_names,
          })),
        );
        setRosterMembers(jobMembers);

        setJobStatus(data.job?.status ?? "unknown");
        if (
          data.job?.rating === "thumbs_up" ||
          data.job?.rating === "thumbs_down"
        ) {
          setJobRating(data.job.rating);
        }
        setFileName(data.job?.fileName ?? null);
        setHasSourceVideo(Boolean(data.hasSourceVideo));
        setFrameTimestamps(data.frameTimestamps ?? {});
        setTimings(
          isVideoProcessTimings(data.job?.timingsJson)
            ? data.job.timingsJson
            : null,
        );
        const loadedDedupe =
          data.dedupeReport ?? data.parseSession?.dedupeReport ?? null;
        setDedupeReport(isDedupeReport(loadedDedupe) ? loadedDedupe : null);
        setScoreTargetMeta(data.scoreTargetMeta ?? null);
        const serverRows = (data.rows ?? []).map((row) => ({
          ...row,
          scoreConflict: row.scoreConflict ?? 0,
          dedupeClusterId: row.dedupeClusterId ?? null,
          dedupeFlag: Boolean(row.dedupeFlag ?? row.dedupeClusterId),
        }));
        const restored = restoreVideoReviewDraftIfPresent(
          jobId,
          viewMode,
          serverRows,
        );
        setRows(restored.rows);
        const loadedIsVs = data.scoreTargetMeta?.id === "vs-performance";
        if (restored.form) {
          setEventId(restored.form.eventId);
          setHqEventId(restored.form.hqEventId);
          setBoardKey(restored.form.boardKey);
          setTeam(restored.form.team);
          setRecordedDate(
            loadedIsVs
              ? nearestValidVsPerformanceDate(restored.form.recordedDate)
              : restored.form.recordedDate,
          );
          if (restored.form.bankId) {
            setBankId(restored.form.bankId);
          }
        } else {
          if (data.job?.hqEventId) {
            setHqEventId(data.job.hqEventId);
          }
          if (data.job?.boardKey) {
            setBoardKey(data.job.boardKey);
          }
          if (loadedIsVs) {
            setRecordedDate((prev) => nearestValidVsPerformanceDate(prev));
          }
        }
        setDraftRestored(restored.restored);
        markAutosaveReady(draftDirtyVersionRef.current, restored.savedAt);
        setAllianceId(
          data.alliance?.currentId ??
            data.job?.allianceId ??
            data.parseSession?.allianceId ??
            null,
        );
        setAshedAllianceId(data.alliance?.ashedAllianceId ?? null);
        setAllianceTag(
          data.alliance?.jobTag ?? data.alliance?.currentTag ?? null,
        );
        setAllianceName(data.alliance?.jobName ?? null);
        setAllianceStale(Boolean(data.alliance?.stale));
      } catch (err) {
        setJobStatus("load_error");
        setActionError(
          err instanceof Error ? err.message : tc("connectionFailed"),
        );
      }
    },
    [jobId, markAutosaveReady, rematchMembers, setDraftRestored, tc, viewMode],
  );

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const displayJobStatus = useMemo(() => {
    const terminalStatuses = new Set([
      "review",
      "failed",
      "load_error",
      "complete",
      "discarded",
    ]);
    if (terminalStatuses.has(jobStatus)) {
      return jobStatus;
    }
    if (
      liveJob &&
      (liveJob.status === "pending_approval" ||
        liveJob.status === "queued" ||
        liveJob.status === "extracting" ||
        liveJob.status === "parsing")
    ) {
      return liveJob.status;
    }
    return jobStatus;
  }, [jobStatus, liveJob]);

  useEffect(() => {
    if (!liveJob) {
      return;
    }

    const previousStatus = liveJobStatusRef.current;
    liveJobStatusRef.current = liveJob.status;

    // Only refetch when the job transitions into review/failed (e.g. OCR just
    // finished). The SSE stream re-emits a `snapshot` on every (re)connect and
    // the provider returns a new object reference each time, so this effect
    // would otherwise run on every snapshot — re-running load() and clobbering
    // the reviewer's in-progress edits. See shouldRefetchOnLiveJobStatus.
    if (shouldRefetchOnLiveJobStatus(previousStatus, liveJob.status)) {
      queueMicrotask(() => {
        void load();
      });
    }
  }, [liveJob, load]);

  useEffect(() => {
    rosterMembersHydratedRef.current = false;
    liveJobStatusRef.current = null;
  }, [jobId]);

  // Roster review: enrich stored rows from the job-alliance local roster once
  // members arrive with the job payload (no personal Ashed credential required).
  useEffect(() => {
    if (!scoreTargetMeta?.showRosterColumns) return;
    if (rosterMembers.length === 0) return;
    if (rosterMembersHydratedRef.current) return;
    rosterMembersHydratedRef.current = true;
    setRows((prev) => {
      const mapped = parsedRowsToRosterReviewRows(
        prev,
        rosterMembers,
        allianceTag ?? "",
      );
      return prev.map((row) => {
        const next = mapped.find((entry) => entry.id === row.id);
        if (!next) return row;
        return {
          ...row,
          memberId: next.memberId,
          memberName: next.memberName,
          matchConfidence: next.matchConfidence,
          allianceRank: next.allianceRank,
          heroPowerM: next.heroPowerM,
          memberLevel: next.memberLevel,
          profession: next.profession,
          allianceRankTitle: null,
        };
      });
    });
  }, [allianceTag, rosterMembers, scoreTargetMeta?.showRosterColumns]);

  const eventTypeLabel = scoreTargetMeta?.labelKey
    ? tNav(scoreTargetMeta.labelKey)
    : "";

  useEffect(() => {
    async function fetchEvents() {
      if (!scoreTargetMeta) return;

      if (scoreTargetMeta.usesHqEvents) {
        if (!allianceId) return;
        const res = await fetch(
          `/api/hq-events?scoreTarget=${encodeURIComponent(scoreTargetMeta.id)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            events?: Array<{
              id: string;
              name: string;
              startDate?: string | null;
              endDate?: string | null;
            }>;
          };
          const list = (data.events ?? []).map((ev) => ({
            id: ev.id,
            label: formatHqEventOptionLabel({
              eventTypeLabel,
              event: ev,
              locale,
              timezoneId,
            }),
          }));
          setEvents(list);
          if (list[0] && !hqEventId) {
            setHqEventId(list[0].id);
          }
        }
        return;
      }

      if (!scoreTargetMeta.eventEntity) {
        setEvents([]);
        return;
      }

      // Ashed entity queries must use the Ashed alliance id, not the HQ pk.
      const queryAllianceId = ashedAllianceId;
      if (!queryAllianceId) {
        setEvents([]);
        return;
      }

      const q = encodeURIComponent(
        JSON.stringify({ alliance_id: queryAllianceId }),
      );
      const res = await fetch(
        `/api/bff/v1/entities/${scoreTargetMeta.eventEntity}?q=${q}`,
      );
      if (res.ok) {
        const data = (await res.json()) as AshedEventLike[];
        const list = data.map((ev) => ({
          id: ev.id,
          label: formatAshedEventOptionLabel({
            eventTypeLabel,
            event: ev,
            locale,
            timezoneId,
          }),
          eventDate: resolveAshedEventDate(ev),
        }));
        setEvents(
          list.map(({ id, label }) => ({
            id,
            label,
          })),
        );
        if (!eventId) {
          const matched = pickAshedEventMatchingDate(data, recordedDate);
          if (matched?.id) {
            setEventId(matched.id);
          } else if (list[0]) {
            setEventId(list[0].id);
          }
        }
      }
    }
    void fetchEvents();
  }, [
    allianceId,
    ashedAllianceId,
    scoreTargetMeta,
    eventId,
    hqEventId,
    eventTypeLabel,
    locale,
    timezoneId,
    recordedDate,
  ]);

  useEffect(() => {
    if (
      viewMode !== "review" ||
      !scoreTargetMeta?.showTeamSelector ||
      !recordedDate
    ) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      team,
      recordedDate,
    });
    if (eventId) {
      params.set("eventId", eventId);
    }

    void (async () => {
      try {
        const res = await fetch(
          `/api/tools/video-upload/${jobId}/score-overlap?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          if (!controller.signal.aborted) {
            setStormOverlapWarning(false);
          }
          return;
        }
        const data = (await res.json()) as { overlaps?: boolean };
        if (!controller.signal.aborted) {
          setStormOverlapWarning(Boolean(data.overlaps));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setStormOverlapWarning(false);
        }
      }
    })();

    return () => controller.abort();
  }, [
    viewMode,
    scoreTargetMeta?.showTeamSelector,
    jobId,
    eventId,
    team,
    recordedDate,
  ]);

  useEffect(() => {
    if (!scoreTargetMeta?.showBankSelector) return;
    void (async () => {
      const res = await fetch("/api/banks");
      if (!res.ok) return;
      const data = (await res.json()) as { banks?: SerializedBank[] };
      const list = data.banks ?? [];
      setBanks(list);
      if (bankId) return;
      const preferredId = readPreferredDepositSlipBankId();
      const preferred =
        preferredId != null
          ? list.find((bank) => bank.id === preferredId)
          : undefined;
      if (preferred) {
        setBankId(preferred.id);
        return;
      }
      if (list[0]) {
        setBankId(list[0].id);
      }
    })();
  }, [scoreTargetMeta?.showBankSelector, bankId]);

  useEffect(() => {
    const groupFetchStatuses = new Set(["review", "complete", "discarded"]);
    if (!groupFetchStatuses.has(jobStatus)) return;
    void (async () => {
      const res = await fetch(`/api/tools/video-upload/${jobId}/group`);
      if (res.ok) {
        const data = (await res.json()) as GroupInfo;
        setGroupInfo(data);
        const comp = data.group?.comparisonJson;
        if (
          viewMode === "review" &&
          jobStatus === "review" &&
          comp?.recommendedJobId &&
          comp.recommendedJobId !== data.group?.selectedJobId &&
          !comparisonDismissed
        ) {
          setShowComparisonPrompt(true);
        }
      }
    })();
  }, [jobId, jobStatus, comparisonDismissed, viewMode]);

  const updateGroupSelection = useCallback(
    async (
      patch: { selectedJobId?: string; accuracyJobId?: string },
      busyKey?: string,
    ) => {
      if (!groupInfo?.group) return false;
      setGroupActionBusy(busyKey ?? "group");
      try {
        const res = await fetch(
          `/api/tools/video-upload/groups/${groupInfo.group.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setActionError(data.error ?? tc("uploadFailed"));
          return false;
        }
        return true;
      } finally {
        setGroupActionBusy(null);
      }
    },
    [groupInfo, tc],
  );

  const canComparePasses = useMemo(
    () =>
      (groupInfo?.group?.comparisonJson?.passes.length ?? 0) >= 2,
    [groupInfo],
  );

  const openComparisonSheet = useCallback(() => {
    setShowComparisonSheet(true);
    const url = new URL(window.location.href);
    url.searchParams.set("compare", "1");
    window.history.replaceState({}, "", url);
  }, []);

  const closeComparisonSheet = useCallback(() => {
    setShowComparisonSheet(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("compare");
    window.history.replaceState({}, "", url);
  }, []);

  useEffect(() => {
    if (!canComparePasses) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("compare") !== "1") return;
    const frame = requestAnimationFrame(() => setShowComparisonSheet(true));
    return () => cancelAnimationFrame(frame);
  }, [canComparePasses, jobId, groupInfo]);

  const handleUseBetterPass = useCallback(async () => {
    const comp = groupInfo?.group?.comparisonJson;
    const recommendedId = comp?.recommendedJobId;
    if (!recommendedId || !groupInfo?.group) return;
    const ok = await updateGroupSelection(
      { selectedJobId: recommendedId },
      "better-pass",
    );
    if (!ok) return;
    setShowComparisonPrompt(false);
    setComparisonDismissed(true);
    window.location.href = `/tools/video-upload/${recommendedId}/review`;
  }, [groupInfo, updateGroupSelection]);

  const zeroScoreWarningDisabled = isZeroScoreWarningDisabled(
    scoreTargetMeta?.id ?? "",
  );

  const activeRows = useMemo(
    () => rows.filter((r) => !r.deleted),
    [rows],
  );

  const filteredRows = useMemo(
    () =>
      filterQuery.trim()
        ? activeRows.filter(
            (r) =>
              r.ocrName.toLowerCase().includes(filterQuery.toLowerCase()) ||
              (r.memberName?.toLowerCase().includes(filterQuery.toLowerCase()) ??
                false),
          )
        : activeRows,
    [activeRows, filterQuery],
  );

  const onDepositSlipVisibleRowIdsChange = useCallback(
    (ids: readonly string[]) => {
      setDepositSlipVisibleRowIds((prev) => {
        if (
          prev.length === ids.length &&
          prev.every((id, index) => id === ids[index])
        ) {
          return prev;
        }
        return [...ids];
      });
    },
    [],
  );

  // Deposit-slip table applies a broader filter + its own sort; Follow-me must
  // interpolate over that visible order, not the parent name/member filter.
  const followMeRows = useMemo(() => {
    if (!scoreTargetMeta?.showDepositSlipColumns) {
      return filteredRows;
    }
    const byId = new Map(activeRows.map((row) => [row.id, row]));
    return depositSlipVisibleRowIds
      .map((id) => byId.get(id))
      .filter((row): row is ParsedRow => row != null);
  }, [
    scoreTargetMeta?.showDepositSlipColumns,
    filteredRows,
    activeRows,
    depositSlipVisibleRowIds,
  ]);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setPreviewFollowMe(false);
  }, [setPreviewOpen, setPreviewFollowMe]);

  const togglePreviewOpen = useCallback(() => {
    setPreviewOpen((open) => {
      if (open) setPreviewFollowMe(false);
      return !open;
    });
  }, [setPreviewOpen, setPreviewFollowMe]);

  const openRowVideoPreview = useCallback(
    (row: ParsedRow) => {
      const seconds = previewSeekSecondsForFrame(
        row.frameIndex,
        frameTimestamps,
      );
      if (seconds == null) return;
      setPreviewSeekRequest((prev) => ({
        seconds,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      setPreviewOpen(true);
    },
    [frameTimestamps, setPreviewOpen],
  );

  const secondsForFollowRow = useCallback(
    (row: ParsedRow) =>
      hasSourceVideo
        ? previewSeekSecondsForFrame(row.frameIndex, frameTimestamps)
        : null,
    [hasSourceVideo, frameTimestamps],
  );

  // Scrub the already-open preview imperatively so per-scroll-frame follow-me
  // seeks don't re-render the whole review tree.
  const seekFollowSeconds = useCallback((seconds: number) => {
    previewSeekControllerRef.current?.seek(seconds);
  }, []);

  const onDepositSlipSortKeyChange = useCallback(
    (next: DepositSlipVisibleSortKey) => {
      setDepositSlipSortKey(next);
      if (!depositSlipFollowMeCompatible(next)) {
        setPreviewFollowMe(false);
      }
    },
    [setPreviewFollowMe],
  );

  // Follow-me for any non-roster review table that registers row anchors
  // (score leaderboards and deposit-slip history). Deposit-slip Follow-me is
  // only meaningful sorted by depositAt — commander sort has unrelated frame
  // times as visual neighbors.
  const scoreTableFollowMeEnabled =
    hasSourceVideo &&
    !scoreTargetMeta?.showRosterColumns &&
    previewFollowMe &&
    previewOpen &&
    (!scoreTargetMeta?.showDepositSlipColumns ||
      depositSlipFollowMeCompatible(depositSlipSortKey));

  const { registerFollowAnchor } = useVideoReviewFollowMe({
    enabled: scoreTableFollowMeEnabled,
    rows: followMeRows,
    secondsForRow: secondsForFollowRow,
    onSeekSeconds: seekFollowSeconds,
    previewOpen,
    previewPlacement: effectivePreviewPlacement,
    dockHeightPx: previewDockHeightPx,
  });

  // Open the source preview when landing on a review job that has video (once per
  // job visit). Users can still close it during the session; revisiting or
  // refreshing the page opens it again.
  useEffect(() => {
    if (!hasSourceVideo) return;
    if (previewAutoOpenedForJobRef.current === jobId) return;
    previewAutoOpenedForJobRef.current = jobId;
    setPreviewOpen(true);
  }, [hasSourceVideo, jobId, setPreviewOpen]);

  const matchedCount = activeRows.filter((r) => r.memberId).length;

  const scoreDuplicateMemberIssues = useMemo(
    () =>
      findDuplicateMemberAssignments(
        activeRows.map((row) => ({
          id: row.id,
          memberId: row.memberId,
          memberName: row.memberName,
          ocrName: row.ocrName,
        })),
      ),
    [activeRows],
  );

  const rosterValidation = useRosterReviewValidation(
    activeRows.map((row) => ({
      id: row.id,
      ocrName: row.ocrName,
      allianceRank: row.allianceRank ?? null,
      heroPowerM: row.heroPowerM ?? null,
      memberLevel: row.memberLevel ?? null,
      profession: row.profession ?? null,
      frameIndex: row.frameIndex,
      memberId: row.memberId,
      memberName: row.memberName,
      matchConfidence: row.matchConfidence,
      deleted: row.deleted,
      matchMethod: row.matchMethod,
    })),
  );

  const depositSlipValidation = useDepositSlipReviewValidation(
    activeRows.map((row) => ({
      id: row.id,
      ocrName: row.ocrName,
      score: row.score,
      powerLevel: row.powerLevel ?? null,
      memberLevel: row.memberLevel ?? null,
      profession: row.profession ?? null,
      allianceRankTitle: row.allianceRankTitle ?? null,
      rosterRankRaw: row.rosterRankRaw ?? null,
      frameIndex: row.frameIndex,
      dedupeClusterId: row.dedupeClusterId ?? null,
      dedupeFlag: row.dedupeFlag,
      deleted: row.deleted,
    })),
    dedupeReport,
  );

  const scoreDuplicateRowIds = useMemo(
    () => duplicateMemberRowIds(scoreDuplicateMemberIssues),
    [scoreDuplicateMemberIssues],
  );

  const duplicateMemberIssues = scoreTargetMeta?.showRosterColumns
    ? rosterValidation.duplicateMemberIssues
    : scoreDuplicateMemberIssues;

  const duplicateRowIds = scoreTargetMeta?.showRosterColumns
    ? rosterValidation.duplicateRowIds
    : scoreDuplicateRowIds;

  const hasScoreConflicts =
    scoreTargetMeta?.showScoreColumn !== false &&
    activeRows.some((row) => row.scoreConflict);
  const hasDuplicateMembers = duplicateMemberIssues.length > 0;
  const hasDuplicateOcrNames =
    scoreTargetMeta?.showRosterColumns && rosterValidation.hasDuplicateOcrNames;
  const hasUnresolvedNameMismatches =
    scoreTargetMeta?.showRosterColumns &&
    rosterValidation.hasUnresolvedNameMismatches;
  const needsEventPicker =
    scoreTargetMeta?.usesHqEvents ||
    Boolean(scoreTargetMeta?.eventEntity);
  const needsBoardPicker =
    scoreTargetMeta?.leaderboardModel === "multi-board";
  const selectedEventId = scoreTargetMeta?.usesHqEvents ? hqEventId : eventId;

  // For non-HQ-native event targets (e.g. alliance-exercise, zombie-siege),
  // the server auto-provisions an Ashed event entity when none is selected —
  // so we don't block save when the events list is empty.
  const eventGateSatisfied =
    !needsEventPicker ||
    selectedEventId !== "" ||
    (!scoreTargetMeta?.usesHqEvents && events.length === 0);


  const submitReadinessStatus =
    liveJob?.status === "submitting" ? "submitting" : displayJobStatus;

  const canSubmit =
    isVideoJobReadyForSubmit(submitReadinessStatus) &&
    activeRows.length > 0 &&
    eventGateSatisfied &&
    (!needsBoardPicker || boardKey) &&
    (!scoreTargetMeta?.showBankSelector || Boolean(bankId)) &&
    !hasDuplicateMembers &&
    !hasDuplicateOcrNames &&
    !hasUnresolvedNameMismatches &&
    !submitting &&
    !(
      scoreTargetMeta?.maxSubmitRows != null &&
      activeRows.length > scoreTargetMeta.maxSubmitRows
    ) &&
    (scoreTargetMeta?.showRosterColumns
      ? rosterQuotaCanSubmit
      : true) &&
    (scoreTargetMeta?.showDepositSlipColumns
      ? depositSlipValidation.canSubmitSlips
      : true);

  function updateRosterRow(id: string, patch: Partial<ParsedRow>) {
    markDraftDirty();
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch, edited: 1 };
        if ("heroPowerM" in patch) {
          next.powerLevel = formatHeroPowerMForStorage(patch.heroPowerM ?? null);
        }
        return next;
      }),
    );
  }

  function updateRow(id: string, patch: Partial<ParsedRow>) {
    markDraftDirty();
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function deleteRow(id: string) {
    markDraftDirty();
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, deleted: 1 } : r)),
    );
  }

  async function handleSubmit() {
    if (hasDuplicateMembers || hasDuplicateOcrNames) {
      setActionError(t("duplicateMemberBlocked"));
      return;
    }
    if (
      scoreTargetMeta?.showDepositSlipColumns &&
      depositSlipValidation.hasUnresolvedFlaggedClusters
    ) {
      setActionError(t("depositSlipFlaggedBlocked"));
      return;
    }
    if (
      scoreTargetMeta?.showDepositSlipColumns &&
      depositSlipValidation.incompleteRowIds.size > 0
    ) {
      setActionError(t("depositSlipIncompleteBlocked"));
      return;
    }
    if (
      scoreTargetMeta?.id === "vs-performance" &&
      !isValidVsPerformanceRecordedDate(vsSafeRecordedDate)
    ) {
      setActionError(t("vsSundayInvalid"));
      return;
    }

    setSubmitting(true);
    clearActionError();
    setSuccess(null);
    try {
      const isRoster = scoreTargetMeta?.showRosterColumns;
      const isDepositSlip = scoreTargetMeta?.showDepositSlipColumns;
      const res = await fetch(`/api/tools/video-upload/${jobId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: scoreTargetMeta?.usesHqEvents ? undefined : eventId,
          hqEventId: scoreTargetMeta?.usesHqEvents ? hqEventId : undefined,
          boardKey: needsBoardPicker ? boardKey : undefined,
          team: scoreTargetMeta?.showTeamSelector ? team : undefined,
          recordedDate: isVsPerformanceTarget
            ? vsSafeRecordedDate
            : recordedDate,
          bankId: scoreTargetMeta?.showBankSelector ? bankId : undefined,
          rows: rows.map((r) =>
            isRoster
              ? {
                  id: r.id,
                  memberId: r.memberId,
                  memberName:
                    r.deleted === 1 ? r.memberName : r.memberName ?? r.ocrName,
                  allianceRank: r.allianceRank,
                  heroPowerM: r.heroPowerM,
                  memberLevel: r.memberLevel,
                  profession: r.profession,
                  deleted: r.deleted === 1,
                }
              : isDepositSlip
                ? {
                    id: r.id,
                    ocrName: r.ocrName,
                    score: r.score ?? "",
                    powerLevel: r.powerLevel ?? null,
                    memberLevel: r.memberLevel,
                    profession: r.profession,
                    allianceRankTitle: r.allianceRankTitle ?? null,
                    rosterRankRaw: r.rosterRankRaw ?? null,
                    frameIndex: r.frameIndex ?? null,
                    deleted: r.deleted === 1,
                  }
                : {
                    id: r.id,
                    memberId: r.memberId,
                    memberName:
                      r.deleted === 1 ? r.memberName : r.memberName ?? r.ocrName,
                    score: r.score ?? "",
                    rank: r.rank,
                    deleted: r.deleted === 1,
                  },
          ),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        submitted?: number;
        duplicateMembers?: Array<{ memberName: string }>;
        showSolicitedFeedback?: boolean;
        solicitedSource?: "solicited_first_upload" | "solicited_third_upload";
      };
      if (!res.ok) {
        setActionError(data.error ?? tc("uploadFailed"));
        return;
      }
      clearDraft();
      setSuccess(
        isEventView
          ? t("updateSuccess", { count: data.submitted ?? 0 })
          : scoreTargetMeta?.showRosterColumns
            ? t("rosterSubmitSuccess", { count: data.submitted ?? 0 })
            : scoreTargetMeta?.showDepositSlipColumns
              ? t("depositSlipSubmitSuccess", { count: data.submitted ?? 0 })
              : t("submitSuccess", { count: data.submitted ?? 0 }),
      );
      // Stay on review through success + OCR rating; event redirect resumes after.
      if (!isEventView) {
        setHoldEventRedirect(true);
      }
      setJobStatus("complete");
      if (
        !isEventView &&
        data.showSolicitedFeedback &&
        data.solicitedSource
      ) {
        showExperienceFeedback({
          videoJobId: jobId,
          source: data.solicitedSource,
          isSolicited: true,
          delayMs: 1500,
        });
      }
      if (!isEventView && !jobRating) {
        setShowRatingPrompt(true);
      } else if (!isEventView) {
        if (holdEventRedirectTimeoutRef.current != null) {
          window.clearTimeout(holdEventRedirectTimeoutRef.current);
        }
        holdEventRedirectTimeoutRef.current = window.setTimeout(() => {
          holdEventRedirectTimeoutRef.current = null;
          setHoldEventRedirect(false);
        }, 1500);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function clearActionError() {
    setError(null);
    setErrorConnectUrl(null);
  }

  function setActionError(message: string, connectUrl?: string) {
    setError(message);
    setErrorConnectUrl(connectUrl ?? null);
  }

  function renderActionErrorBanner() {
    if (!error) {
      return null;
    }
    return (
      <ReviewActionErrorBanner
        message={error}
        connectUrl={errorConnectUrl ?? undefined}
        connectLabel={tQueue("connectCta")}
        onDismiss={clearActionError}
        dismissLabel={t("comparisonClose")}
      />
    );
  }

  async function reprocess() {
    setReprocessPending(true);
    clearActionError();
    setSuccess(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/reprocess`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        connectUrl?: string;
        status?: string;
      };
      if (!res.ok) {
        if (data.code === "ashed_not_connected") {
          const reviewPath = `/tools/video-upload/${jobId}/review`;
          stashConnectReturnPath(reviewPath);
          router.push(
            data.connectUrl ?? buildConnectHref(reviewPath),
          );
          return;
        }
        setActionError(data.error ?? tc("uploadFailed"), data.connectUrl);
        return;
      }
      clearDraft();
      setRows([]);
      // Seed the live-status ref so SSE review after queued triggers a refetch
      // (without this, a reconnect snapshot of review alone is ignored).
      liveJobStatusRef.current = "queued";
      setJobStatus(data.status === "review" ? "review" : "queued");
      if (data.status === "review") {
        void load();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setReprocessPending(false);
    }
  }

  async function handleDiscard() {
    setDiscarding(true);
    clearActionError();
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/discard`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setActionError(data.error ?? tc("uploadFailed"));
        return;
      }
      clearDraft();
      router.push("/tools/video-upload");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setDiscarding(false);
    }
  }

  async function persistJobRating(
    rating: "thumbs_up" | "thumbs_down",
    reason?: OcrRatingReason,
  ): Promise<boolean> {
    setJobRating(rating);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/rating`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, ratingReason: reason }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setJobRating(null);
        setActionError(data.error ?? tc("uploadFailed"));
        return false;
      }
      return true;
    } catch (err) {
      setJobRating(null);
      setActionError(err instanceof Error ? err.message : tc("uploadFailed"));
      return false;
    }
  }

  async function handleAddRow(position: ManualRowPosition) {
    if (addingRowBusy) return;
    setAddingRowBusy(position);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { row: ParsedRow };
      markDraftDirty();
      setRows((prev) =>
        mergeParsedRowInReviewOrder(prev, data.row, scoreTargetMeta?.id),
      );
    } finally {
      setAddingRowBusy(null);
    }
  }

  if (displayJobStatus === "loading" || rematching) {
    return (
      <div className="space-y-4">
        {renderActionErrorBanner()}
        <p className="text-sm text-hq-fg-muted">
          {rematching ? t("rematchingMembers") : t("loading")}
        </p>
      </div>
    );
  }

  if (
    displayJobStatus === "pending_approval" ||
    displayJobStatus === "queued" ||
    displayJobStatus === "extracting" ||
    displayJobStatus === "parsing"
  ) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-hq-fg-muted">
          {displayJobStatus === "pending_approval"
            ? t("pendingApproval")
            : t("processing", { status: displayJobStatus })}
        </p>
        <Link href="/tools/video-upload" className="text-sm text-hq-accent hover:underline">
          {t("backToUploads")}
        </Link>
      </div>
    );
  }

  if (displayJobStatus === "load_error") {
    return (
      <div className="space-y-4">
        <ReviewActionErrorBanner
          message={error ?? tc("uploadFailed")}
          connectUrl={errorConnectUrl ?? undefined}
          connectLabel={tQueue("connectCta")}
          onDismiss={clearActionError}
          dismissLabel={t("comparisonClose")}
        />
        <Link href="/tools/video-upload" className="text-sm text-hq-accent hover:underline">
          {t("backToUploads")}
        </Link>
      </div>
    );
  }

  if (displayJobStatus === "failed") {
    return (
      <div className="space-y-4">
        <ReviewActionErrorBanner
          message={error ?? t("processingFailed")}
          connectUrl={errorConnectUrl ?? undefined}
          connectLabel={tQueue("connectCta")}
          onDismiss={clearActionError}
          dismissLabel={t("comparisonClose")}
        />
        <Link href="/tools/video-upload" className="text-sm text-hq-accent hover:underline">
          {t("backToUploads")}
        </Link>
      </div>
    );
  }

  const showSidePreview =
    previewOpen && effectivePreviewPlacement === "side";
  const showTopPreview = previewOpen && effectivePreviewPlacement === "top";
  const showBottomPreview =
    previewOpen && effectivePreviewPlacement === "bottom";
  const previewNode = previewOpen ? (
    <ReviewVideoPreview
      jobId={jobId}
      placement={effectivePreviewPlacement}
      available={previewPlacements}
      onPlacementChange={setPreviewPlacement}
      zoom={previewZoom}
      onZoomChange={setPreviewZoom}
      onClose={closePreview}
      unavailable={!hasSourceVideo}
      seekRequest={previewSeekRequest}
      seekControllerRef={previewSeekControllerRef}
      sideWidthPx={previewSideWidthPx}
      dockHeightPx={previewDockHeightPx}
      onSideWidthChange={setPreviewSideWidthPx}
      onDockHeightChange={setPreviewDockHeightPx}
    />
  ) : null;

  // overflow-x-clip (not hidden): hidden makes the other axis a scrollport and
  // breaks position:sticky for the top/side preview — follow-me then scrolls
  // the pane away. clip matches AshedShell and keeps sticky on the viewport.
  // -mt cancels <main>'s p-4/md:p-6 so the sticky pane sits flush under the
  // shell header instead of floating with a padded gap that pushes controls
  // below the fold.
  const stickyPreviewOpen = showTopPreview || showSidePreview;

  return (
    <div
      className={`relative flex min-w-0 w-full max-w-full overflow-x-clip ${
        showSidePreview ? "flex-row" : "flex-col"
      } ${stickyPreviewOpen ? "-mt-4 md:-mt-6" : ""}`}
    >
      {showTopPreview ? previewNode : null}
      <div
        className={`flex min-w-0 max-w-full flex-1 flex-col overflow-x-clip ${
          showSidePreview ? "pt-4 md:pt-6" : ""
        }`}
        style={
          showBottomPreview
            ? { paddingBottom: previewDockHeightPx }
            : undefined
        }
      >
        <div className="mx-auto min-w-0 w-full max-w-5xl flex-1 space-y-6 px-4 pb-6 md:px-0">
          {renderActionErrorBanner()}
          <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Link
            href="/tools/video-upload"
            className="text-sm text-hq-accent hover:underline"
          >
            {t("backToUploads")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {canComparePasses ? (
              <button
                type="button"
                onClick={openComparisonSheet}
                className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted"
              >
                {t("comparisonSideBySide")}
              </button>
            ) : null}
            {hasSourceVideo ? (
              <button
                type="button"
                onClick={togglePreviewOpen}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                  previewOpen
                    ? "border-hq-accent bg-[#0c2d6b]/40 text-hq-accent"
                    : "border-hq-border text-hq-fg hover:bg-hq-surface-muted"
                }`}
              >
                <MonitorPlay className="h-4 w-4 shrink-0" aria-hidden />
                {t("previewVideo")}
              </button>
            ) : null}
            {hasSourceVideo && !scoreTargetMeta?.showRosterColumns ? (
              <button
                type="button"
                disabled={
                  !!scoreTargetMeta?.showDepositSlipColumns &&
                  !depositSlipFollowMeCompatible(depositSlipSortKey)
                }
                onClick={() => {
                  setPreviewFollowMe((on) => {
                    const next = !on;
                    if (next) setPreviewOpen(true);
                    return next;
                  });
                }}
                aria-pressed={previewFollowMe}
                title={t("followMeHint")}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                  previewFollowMe
                    ? "border-hq-accent bg-[#0c2d6b]/40 text-hq-accent"
                    : "border-hq-border text-hq-fg hover:bg-hq-surface-muted"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <LocateFixed className="h-4 w-4 shrink-0" aria-hidden />
                {t("followMe")}
              </button>
            ) : null}
            <VideoPipelineStatsButton
              timings={timings}
              fileName={fileName}
              comparisonJson={groupInfo?.group?.comparisonJson ?? null}
              onOpenComparison={canComparePasses ? openComparisonSheet : undefined}
            />
          </div>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">
          {isEventView ? t("eventTitle") : t("title")}
        </h1>
        <p className="mt-1 text-sm text-hq-fg-muted">
          {isEventView
            ? t("eventSubtitle")
            : t("summary", {
                matched: matchedCount,
                total: activeRows.length,
              })}
        </p>
      </div>

      {scoreTargetMeta?.showRosterColumns && allianceTag ? (
        <RosterAllianceBanner
          tag={allianceTag}
          name={allianceName}
          stale={allianceStale}
        />
      ) : null}

      {draftEnabled && (draftRestored || draftSavedAt) ? (
        <div
          className="rounded-xl border border-hq-border bg-hq-surface px-4 py-3 text-sm text-hq-fg-muted"
          role="status"
        >
          {draftRestored ? <p>{t("draftRestored")}</p> : null}
          {draftSavedAt ? (
            <p className={draftRestored ? "mt-1" : undefined}>
              {t("draftSavedLocally", { time: formattedDraftSavedAt })}
            </p>
          ) : null}
        </div>
      ) : null}

      {activeRows.length === 0 && !isEventView && (
        <div className="rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-4 text-sm">
          <p className="text-[#e3b341]">{t("noEntriesHint")}</p>
          <button
            type="button"
            onClick={() => void reprocess()}
            disabled={reprocessPending}
            className="mt-3 rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {reprocessPending ? t("reprocessing") : t("reprocess")}
          </button>
        </div>
      )}

      {hasScoreConflicts && (
        <div className="rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-4 text-sm text-[#e3b341]">
          <p>{t("scoreConflictHint")}</p>
        </div>
      )}

      {hasDuplicateMembers && (
        <div className="rounded-xl border border-hq-danger/40 bg-[#f8514915] p-4 text-sm text-hq-danger">
          <p className="font-medium">{t("duplicateMemberTitle")}</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {duplicateMemberIssues.map((issue) => (
              <li key={issue.memberId}>
                {t("duplicateMemberItem", {
                  member: issue.memberName,
                  count: issue.rowIds.length,
                })}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-hq-fg">{t("duplicateMemberHint")}</p>
        </div>
      )}

      {hasDuplicateOcrNames && (
        <div className="rounded-xl border border-hq-danger/40 bg-[#f8514915] p-4 text-sm text-hq-danger">
          <p>{t("duplicateOcrNameRow")}</p>
        </div>
      )}

      {showComparisonPrompt &&
        !isEventView &&
        groupInfo?.group &&
        !showComparisonSheet ? (
        <div className="rounded-xl border border-hq-accent bg-[#58a6ff10] p-4">
          <p className="font-medium text-hq-fg">{t("comparisonPromptTitle")}</p>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("comparisonPromptBody")}</p>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!!groupActionBusy}
                onClick={() => void handleUseBetterPass()}
                className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {groupActionBusy === "better-pass"
                  ? t("submitting")
                  : t("comparisonUseBetter")}
              </button>
              <button
                type="button"
                onClick={openComparisonSheet}
                className="hidden rounded-lg border border-hq-border px-3 py-1.5 text-sm hover:bg-hq-surface-muted sm:inline-flex"
              >
                {t("comparisonSideBySide")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowComparisonPrompt(false);
                  setComparisonDismissed(true);
                }}
                className="text-sm text-hq-fg-muted hover:text-hq-fg"
              >
                {t("comparisonDismiss")}
              </button>
            </div>
            <button
              type="button"
              onClick={openComparisonSheet}
              className="self-start text-sm text-hq-accent hover:underline sm:hidden"
            >
              {t("comparisonSideBySide")}
            </button>
          </div>
        </div>
      ) : null}

      <form
        className="space-y-6"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void handleSubmit();
        }}
      >
      {!scoreTargetMeta?.showRosterColumns &&
      !scoreTargetMeta?.showDepositSlipColumns ? (
      <div className="grid gap-4 rounded-xl border border-hq-border bg-hq-surface p-4 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        {needsEventPicker ? (
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-hq-fg-muted">{t("eventLabel")}</span>
            {/* Non-HQ event target with no existing events: show an
                auto-create note instead of a broken empty dropdown.
                The server will provision an event entity automatically. */}
            {!scoreTargetMeta?.usesHqEvents && events.length === 0 ? (
              <p className="mt-1 text-xs text-hq-fg-muted max-w-xs">
                {t("noEventsAutoCreate")}
              </p>
            ) : (
              <AppSelect
                value={scoreTargetMeta?.usesHqEvents ? hqEventId : eventId}
                onChange={(next) => {
                  markDraftDirty();
                  if (scoreTargetMeta?.usesHqEvents) {
                    setHqEventId(next);
                  } else {
                    setEventId(next);
                  }
                }}
                aria-label={t("eventLabel")}
                options={[
                  ...(events.length === 0
                    ? [{ value: "", label: t("noEventsOption"), disabled: true }]
                    : []),
                  ...events.map((ev) => ({
                    value: ev.id,
                    label: ev.label,
                  })),
                ]}
              />
            )}
            {scoreTargetMeta?.usesHqEvents && events.length === 0 ? (
              <button
                type="button"
                className="mt-2 text-xs text-hq-accent hover:underline"
                onClick={() => {
                  void (async () => {
                    const label = formatEventOptionLabel({
                      eventTypeLabel,
                      eventDate: recordedDate,
                      locale,
                      timezoneId,
                    });
                    const res = await fetch("/api/hq-events", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        scoreTarget: scoreTargetMeta.id,
                        name: label,
                        startDate: recordedDate,
                        endDate: recordedDate,
                      }),
                    });
                    if (res.ok) {
                      const data = (await res.json()) as {
                        event?: { id: string };
                      };
                      if (data.event?.id) {
                        markDraftDirty();
                        setHqEventId(data.event.id);
                        setEvents([{ id: data.event.id, label }]);
                      }
                    }
                  })();
                }}
              >
                {t("createHqEvent")}
              </button>
            ) : null}
          </label>
        ) : null}
        {needsBoardPicker ? (
          <label className="block text-sm">
            <span className="mb-1 block text-hq-fg-muted">{t("boardLabel")}</span>
            <AppSelect
              value={boardKey}
              onChange={(next) => {
                markDraftDirty();
                setBoardKey(next);
              }}
              placeholder={t("boardPlaceholder")}
              aria-label={t("boardLabel")}
              options={(scoreTargetMeta?.boardTypes ?? []).map((board) => ({
                value: board,
                label: t(`boardTypes.${board}`),
              }))}
            />
          </label>
        ) : null}
        {scoreTargetMeta?.showTeamSelector ? (
          <div className="block text-sm">
            <span className="mb-1 block text-hq-fg-muted">{t("teamLabel")}</span>
            <div
              role="group"
              aria-label={t("teamLabel")}
              className="flex items-center gap-0.5 rounded-lg border border-hq-border p-0.5"
            >
              {(["A", "B"] as const).map((option) => {
                const active = team === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      markDraftDirty();
                      setTeam(option);
                    }}
                    aria-pressed={active}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-hq-border text-hq-fg"
                        : "text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
                    }`}
                  >
                    {option === "A" ? t("teamA") : t("teamB")}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <label className="block text-sm">
          <span className="mb-1 block text-hq-fg-muted">{t("dateLabel")}</span>
          {isVsPerformanceTarget ? (
            <AppSelect
              value={vsSafeRecordedDate}
              onChange={(next) => {
                if (!isValidVsPerformanceRecordedDate(next)) {
                  setActionError(t("vsSundayInvalid"));
                  return;
                }
                markDraftDirty();
                setRecordedDate(next);
              }}
              options={vsRecordedDateOptions}
              searchable
              placeholder={t("dateLabel")}
              aria-label={t("dateLabel")}
              noSearchResultsLabel={t("memberSearchNoResults")}
            />
          ) : (
            <input
              type="date"
              value={recordedDate}
              onChange={(e) => {
                markDraftDirty();
                setRecordedDate(e.target.value);
              }}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
            />
          )}
        </label>
      </div>
      ) : null}

      {stormOverlapWarning &&
      viewMode === "review" &&
      scoreTargetMeta?.showTeamSelector ? (
        <div
          role="status"
          className="rounded-xl border border-hq-warning/40 bg-hq-warning/10 px-4 py-3 text-sm text-hq-warning"
        >
          <p>
            {t("existingStormScoresWarning", {
              eventName:
                events.find((ev) => ev.id === eventId)?.label ??
                eventTypeLabel ??
                t("eventLabel"),
              team: team === "B" ? "B" : "A",
            })}
          </p>
          <p className="mt-2">
            <Link
              href={`/data-management?scoreTarget=${encodeURIComponent(scoreTargetMeta.id)}&recordedDate=${encodeURIComponent(recordedDate)}`}
              className="font-medium underline underline-offset-2"
            >
              {t("openDataManagement")}
            </Link>
          </p>
        </div>
      ) : null}

      {scoreTargetMeta?.showBankSelector ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <label className="block text-sm">
            <span className="mb-1 block text-hq-fg-muted">
              {t("bankLabel")}
            </span>
            <AppSelect
              value={bankId}
              onChange={(next) => {
                markDraftDirty();
                setBankId(next);
              }}
              placeholder={t("bankPlaceholder")}
              aria-label={t("bankLabel")}
              options={
                banks.length === 0
                  ? [
                      {
                        value: "",
                        label: tBanks("emptyBanks"),
                        disabled: true,
                      },
                    ]
                  : banks.map((bank) => ({
                      value: bank.id,
                      label: tBanks("coords", {
                        server: bank.gameServerNumber,
                        x: bank.coordX,
                        y: bank.coordY,
                      }),
                    }))
              }
            />
          </label>
        </div>
      ) : null}

      {scoreTargetMeta?.showRosterColumns ? (
        <>
          <div className="flex items-center gap-3">
            <input
              type="search"
              form=""
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("filterPlaceholder")}
              className="flex-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm placeholder:text-hq-fg-muted"
            />
            {filterQuery ? (
              <p className="shrink-0 text-xs text-hq-fg-muted">
                {t("filterCount", {
                  shown: filteredRows.length,
                  total: activeRows.length,
                })}
              </p>
            ) : null}
          </div>
          <RosterVideoReviewTable
            rows={activeRows.map((row) => ({
              id: row.id,
              ocrName: row.ocrName,
              allianceRank: row.allianceRank ?? null,
              heroPowerM: row.heroPowerM ?? null,
              memberLevel: row.memberLevel ?? null,
              profession: row.profession ?? null,
              frameIndex: row.frameIndex,
              memberId: row.memberId,
              memberName: row.memberName,
              matchConfidence: row.matchConfidence,
              matchMethod: row.matchMethod,
              deleted: row.deleted,
            }))}
            members={rosterMembers}
            filterQuery={filterQuery}
            duplicateRowIds={duplicateRowIds}
            unmatchedRowIds={rosterValidation.unmatchedRowIds}
            onUpdateRow={updateRosterRow}
            onDeleteRow={deleteRow}
            onPreviewFrame={(frameIndex) => {
              const seconds = previewSeekSecondsForFrame(
                frameIndex,
                frameTimestamps,
              );
              if (seconds == null) return;
              setPreviewSeekRequest((prev) => ({
                seconds,
                nonce: (prev?.nonce ?? 0) + 1,
              }));
              setPreviewOpen(true);
            }}
            rowCanVideoPreview={(frameIndex) =>
              hasSourceVideo &&
              previewSeekSecondsForFrame(frameIndex, frameTimestamps) != null
            }
            onQuotaChange={({ canSubmitRanks }) =>
              setRosterQuotaCanSubmit(canSubmitRanks)
            }
          />
        </>
      ) : scoreTargetMeta?.showDepositSlipColumns ? (
        <>
          <div className="flex items-center gap-3">
            <input
              type="search"
              form=""
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("filterPlaceholder")}
              className="flex-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm placeholder:text-hq-fg-muted"
            />
            {filterQuery ? (
              <p className="shrink-0 text-xs text-hq-fg-muted">
                {t("filterCount", {
                  shown: depositSlipVisibleRowIds.length,
                  total: activeRows.length,
                })}
              </p>
            ) : null}
          </div>
          <DepositSlipVideoReviewTable
            rows={activeRows.map((row) => ({
              id: row.id,
              ocrName: row.ocrName,
              score: row.score,
              powerLevel: row.powerLevel ?? null,
              memberLevel: row.memberLevel ?? null,
              profession: row.profession ?? null,
              allianceRankTitle: row.allianceRankTitle ?? null,
              rosterRankRaw: row.rosterRankRaw ?? null,
              memberId: row.memberId,
              memberName: row.memberName,
              matchConfidence: row.matchConfidence,
              matchMethod: row.matchMethod,
              frameIndex: row.frameIndex,
              dedupeClusterId: row.dedupeClusterId ?? null,
              dedupeFlag: row.dedupeFlag,
              deleted: row.deleted,
            }))}
            filterQuery={filterQuery}
            dedupeReport={dedupeReport}
            onUpdateRow={(id, patch) => updateRow(id, patch)}
            onDeleteRow={deleteRow}
            onPreviewFrame={(frameIndex) => {
              const seconds = previewSeekSecondsForFrame(
                frameIndex,
                frameTimestamps,
              );
              if (seconds == null) return;
              setPreviewSeekRequest((prev) => ({
                seconds,
                nonce: (prev?.nonce ?? 0) + 1,
              }));
              setPreviewOpen(true);
            }}
            rowCanVideoPreview={(frameIndex) =>
              hasSourceVideo &&
              previewSeekSecondsForFrame(frameIndex, frameTimestamps) != null
            }
            registerFollowAnchor={registerFollowAnchor}
            onVisibleRowIdsChange={onDepositSlipVisibleRowIdsChange}
            onSortKeyChange={onDepositSlipSortKeyChange}
          />
        </>
      ) : (
        <>
      <div className="flex items-center gap-3">
        <input
          type="search"
          form=""
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={t("filterPlaceholder")}
          className="flex-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm placeholder:text-hq-fg-muted"
        />
        {filterQuery && (
          <p className="shrink-0 text-xs text-hq-fg-muted">
            {t("filterCount", {
              shown: filteredRows.length,
              total: activeRows.length,
            })}
          </p>
        )}
        <button
          type="button"
          disabled={!!addingRowBusy}
          onClick={() => void handleAddRow("start")}
          className="shrink-0 rounded-lg border border-hq-border px-3 py-2 text-sm hover:bg-hq-surface-muted disabled:opacity-50"
        >
          {addingRowBusy === "start" ? t("addingRow") : t("addRow")}
        </button>
      </div>

      <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-hq-border">
        <table className="w-full min-w-full text-sm">
          <thead className="bg-hq-surface text-left text-hq-fg-muted">
            <tr>
              {scoreTargetMeta?.showRankColumn ? (
                <th className="w-14 px-3 py-3">{t("colRank")}</th>
              ) : null}
              <th className="min-w-0 px-3 py-3">{t("colName")}</th>
              <th className="min-w-[8rem] px-3 py-3 sm:min-w-[11rem]">
                {t("colMember")}
              </th>
              {scoreTargetMeta?.showScoreColumn !== false ? (
                <th className="px-3 py-3">{t("colScore")}</th>
              ) : null}
              <th className="w-10 px-2 py-3">
                <span className="sr-only">{t("rowVideoPreview")}</span>
              </th>
              <th className="w-10 px-2 py-3">
                <span className="sr-only">{t("deleteRow")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isDuplicateMember = duplicateRowIds.has(row.id);
              const rowCanVideoPreview =
                hasSourceVideo &&
                previewSeekSecondsForFrame(row.frameIndex, frameTimestamps) !=
                  null;
              const rowClass = isDuplicateMember
                ? "border-t border-hq-border bg-[#f8514910]"
                : row.scoreConflict
                  ? "border-t border-hq-border bg-[#d2992210]"
                  : "border-t border-hq-border";

              return (
              <tr
                key={row.id}
                className={rowClass}
                ref={registerFollowAnchor(row.id)}
                data-video-follow-anchor={row.id}
              >
                {scoreTargetMeta?.showRankColumn ? (
                  <td className="px-3 py-3 align-top">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.rank ?? ""}
                      onChange={(e) => {
                        updateRow(row.id, {
                          rank: parsePodiumRankInput(e.target.value),
                        });
                      }}
                      aria-label={t("colRank")}
                      className="w-12 rounded-lg border border-hq-border bg-hq-canvas px-2 py-1.5"
                    />
                  </td>
                ) : null}
                <td className="min-w-0 max-w-[9rem] px-3 py-3 align-top font-medium">
                  <div className="truncate" title={row.ocrName}>
                    {row.ocrName}
                  </div>
                  {row.scoreConflict ? (
                    <p className="mt-1 text-xs text-[#d29922]">
                      {t("scoreConflictRow")}
                    </p>
                  ) : null}
                  {isDuplicateMember ? (
                    <p className="mt-1 text-xs text-hq-danger">
                      {t("duplicateMemberRow")}
                    </p>
                  ) : null}
                </td>
                <td className="min-w-[8rem] px-3 py-3 align-top sm:min-w-[11rem]">
                  <AppSelect
                    value={row.memberId ?? ""}
                    onChange={(next) => {
                      const member = members.find((m) => m.id === next);
                      updateRow(row.id, {
                        memberId: next || null,
                        memberName: member?.current_name ?? null,
                        matchConfidence: next ? 1 : 0,
                      });
                    }}
                    aria-label={t("colMember")}
                    placeholder={t("unmatched")}
                    triggerClassName={`px-2 py-1.5 ${confidenceClass(row.matchConfidence)}`}
                    searchable
                    searchMode="fuzzy"
                    combobox
                    hideEmptyOptionWhileSearching
                    searchPlaceholder={tMembers("searchPlaceholder")}
                    noSearchResultsLabel={t("memberSearchNoResults")}
                    options={buildMemberMatchSelectOptions(members, {
                      emptyLabel: t("unmatched"),
                      highlightMemberId: row.memberId,
                      highlightConfidence: row.matchConfidence,
                      selectedMembers: rows,
                    })}
                  />
                </td>
                {scoreTargetMeta?.showScoreColumn !== false ? (
                <td className="px-3 py-3 align-top">
                  {(() => {
                    const scoreText = row.score ?? "";
                    const scoreNum = parseFloat(
                      scoreText.replace(/,/g, ""),
                    );
                    const isZero =
                      !Number.isNaN(scoreNum) && scoreNum === 0;
                    const showZeroWarning = isZero && !zeroScoreWarningDisabled;
                    const isNegative =
                      !Number.isNaN(scoreNum) && scoreNum < 0;
                    return (
                      <>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.score ?? ""}
                          onChange={(e) =>
                            updateRow(row.id, { score: e.target.value })
                          }
                          className={`w-28 rounded-lg border bg-hq-canvas px-2 py-1.5 ${
                            isNegative
                              ? "border-hq-danger"
                              : showZeroWarning
                                ? "border-[#d29922]"
                                : "border-hq-border"
                          }`}
                        />
                        {showZeroWarning && (
                          <p className="mt-1 text-xs text-[#d29922]">
                            {t("scoreZeroWarning")}
                          </p>
                        )}
                        {isNegative && (
                          <p className="mt-1 text-xs text-hq-danger">
                            {t("scoreNegativeWarning")}
                          </p>
                        )}
                      </>
                    );
                  })()}
                </td>
                ) : null}
                <td className="px-2 py-3 align-top">
                  {rowCanVideoPreview ? (
                    <button
                      type="button"
                      onClick={() => openRowVideoPreview(row)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-hq-accent hover:bg-hq-surface-muted"
                      title={t("rowVideoPreview")}
                      aria-label={t("rowVideoPreview")}
                    >
                      <Crosshair className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </td>
                <td className="px-2 py-3 align-top">
                  <button
                    type="button"
                    onClick={() => deleteRow(row.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-hq-danger hover:bg-hq-surface-muted"
                    title={t("deleteRow")}
                    aria-label={t("deleteRow")}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!!addingRowBusy}
          onClick={() => void handleAddRow("end")}
          className="rounded-lg border border-hq-border px-3 py-2 text-sm hover:bg-hq-surface-muted disabled:opacity-50"
        >
          {addingRowBusy === "end" ? t("addingRow") : t("addRow")}
        </button>
      </div>
        </>
      )}

      {success && <p className="text-sm text-hq-green">{success}</p>}

      <div className="flex flex-wrap gap-3">
        <Link
          href="/tools/video-upload"
          className="rounded-lg border border-hq-border px-4 py-2 text-sm hover:bg-hq-surface-muted"
        >
          {tc("back")}
        </Link>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting
            ? t("submitting")
            : scoreTargetMeta?.showRosterColumns
              ? t("saveRoster", { count: activeRows.length })
              : scoreTargetMeta?.showDepositSlipColumns
                ? t("saveDepositSlips", { count: activeRows.length })
                : isEventView
                  ? t("updateScores", { count: activeRows.length })
                  : t("saveScores", { count: activeRows.length })}
        </button>
        {!isEventView ? (
        <button
          type="button"
          disabled={
            discarding ||
            jobStatus === "discarded" ||
            jobStatus === "complete"
          }
          onClick={() => void handleDiscard()}
          className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-danger hover:bg-[#f8514910] disabled:opacity-50"
        >
          {discarding ? tc("loading") : t("discardResults")}
        </button>
        ) : null}
      </div>
      </form>

      {showRatingPrompt ? (
        <OcrRatingPrompt
          onClose={() => {
            setShowRatingPrompt(false);
            if (holdEventRedirectTimeoutRef.current != null) {
              window.clearTimeout(holdEventRedirectTimeoutRef.current);
              holdEventRedirectTimeoutRef.current = null;
            }
            setHoldEventRedirect(false);
          }}
          onRate={persistJobRating}
        />
      ) : null}

      {showComparisonSheet && groupInfo?.group?.comparisonJson ? (
        <PassComparisonSheet
          groupId={groupInfo.group.id}
          comparison={groupInfo.group.comparisonJson}
          passes={groupInfo.passes}
          onClose={closeComparisonSheet}
          onSelectJob={(selectedJobId: string) => {
            void (async () => {
              const ok = await updateGroupSelection(
                { selectedJobId },
                `select:${selectedJobId}`,
              );
              if (!ok) return;
              setShowComparisonSheet(false);
              setShowComparisonPrompt(false);
              setComparisonDismissed(true);
              window.location.href = `/tools/video-upload/${selectedJobId}/review`;
            })();
          }}
          onAccuracyVote={(accuracyJobId: string) => {
            void updateGroupSelection(
              { accuracyJobId },
              `accuracy:${accuracyJobId}`,
            );
          }}
          groupActionBusy={groupActionBusy}
        />
      ) : null}
        </div>
      </div>
      {showSidePreview ? previewNode : null}
      {showBottomPreview ? previewNode : null}
      {hasSourceVideo && !previewOpen ? (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-hq-accent bg-[#0c2d6b] px-4 py-2.5 text-sm font-medium text-hq-fg shadow-lg hover:bg-[#1a4480] sm:bottom-6"
          aria-label={t("previewVideo")}
        >
          <MonitorPlay className="h-4 w-4 shrink-0" aria-hidden />
          {t("previewVideo")}
        </button>
      ) : null}
    </div>
  );
}
