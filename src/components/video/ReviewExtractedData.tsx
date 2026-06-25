"use client";

import { useLocale, useTranslations } from "next-intl";
import { Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link, useRouter } from "@/i18n/navigation";
import { useFeedback } from "@/components/feedback";
import { AppSelect } from "@/components/ui/AppSelect";
import { useAccountTimezone } from "@/components/timezone/TimezoneProvider";
import { useVideoJob } from "@/components/video/VideoJobEventsProvider";
import {
  formatAshedEventOptionLabel,
  formatEventOptionLabel,
  formatHqEventOptionLabel,
  type AshedEventLike,
} from "@/lib/video/event-option-label";
import {
  duplicateMemberRowIds,
  findDuplicateMemberAssignments,
} from "@/lib/video/review-validation";
import { isZeroScoreWarningDisabled } from "@/lib/video/score-targets";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";
import type { ManualRowPosition } from "@/lib/video/manual-row-position";
import { mergeParsedRowInReviewOrder } from "@/lib/video/parsed-row-review-order";
import { isVideoProcessTimings } from "@/lib/video/pipeline-stats-display";
import { VideoPipelineStatsButton } from "@/components/video/VideoPipelineStatsDialog";
import {
  ReviewVideoPreview,
  PREVIEW_DOCK_HEIGHT,
  type VideoSeekRequest,
} from "@/components/video/ReviewVideoPreview";
import { useVideoPreviewLayout } from "@/components/video/useVideoPreviewLayout";
import {
  previewSeekSecondsForFrame,
  type FrameTimestampMap,
} from "@/lib/video/frame-video-seek";
import { accountTodayCalendarDate } from "@/lib/timezone/format";
import { PassComparisonSheet } from "@/components/video/PassComparisonSheet";
import { OcrRatingPrompt, type OcrRatingReason } from "@/components/video/OcrRatingPrompt";
import { RosterAllianceBanner } from "@/components/video/RosterAllianceBanner";
import {
  RosterVideoReviewTable,
  useRosterReviewValidation,
} from "@/components/video/RosterVideoReviewTable";
import type { PassComparison } from "@/lib/video/compare-pass-results";
import type { AllianceMembersPayload } from "@/lib/members/load";
import {
  formatHeroPowerMForStorage,
  parsedRowsToRosterReviewRows,
} from "@/lib/video/roster-video-review.shared";
import type { AshedMember } from "@/lib/video/member-matcher";

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
  deleted: number;
  manuallyAdded?: number;
};

type MemberOption = {
  id: string;
  current_name: string;
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
  if (confidence == null || confidence === 0) return "border-[#f85149]";
  if (confidence >= 0.9) return "border-[#3fb950]";
  if (confidence >= 0.6) return "border-[#d29922]";
  return "border-[#f85149]";
}

export function ReviewExtractedData({ jobId, viewMode = "review" }: Props) {
  const router = useRouter();
  const t = useTranslations("videoReview");
  const tc = useTranslations("common");
  const tNav = useTranslations("nav");
  const tMembers = useTranslations("members");
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
  const [eventId, setEventId] = useState("");
  const [hqEventId, setHqEventId] = useState("");
  const [boardKey, setBoardKey] = useState("");
  const [team, setTeam] = useState<"A" | "B">("A");
  const [recordedDate, setRecordedDate] = useState(() =>
    accountTodayCalendarDate(timezoneId),
  );
  const [filterQuery, setFilterQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [timings, setTimings] = useState<VideoProcessTimings | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasSourceVideo, setHasSourceVideo] = useState(false);
  const {
    placement: previewPlacement,
    available: previewPlacements,
    open: previewOpen,
    setOpen: setPreviewOpen,
    setPlacement: setPreviewPlacement,
  } = useVideoPreviewLayout();
  const [previewSeekRequest, setPreviewSeekRequest] =
    useState<VideoSeekRequest>(null);
  const [frameTimestamps, setFrameTimestamps] = useState<FrameTimestampMap>({});
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [jobRating, setJobRating] = useState<"thumbs_up" | "thumbs_down" | null>(null);
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
  const rosterMembersHydratedRef = useRef(false);
  const isEventView = viewMode === "event";

  useEffect(() => {
    if (jobStatus === "loading") return;
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
  }, [jobId, jobStatus, router, viewMode]);

  const rematchMembers = useCallback(async () => {
    setRematching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tools/video-upload/${jobId}/rematch-members`,
        { method: "POST" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? tc("uploadFailed"));
        return false;
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
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
          stale?: boolean;
        };
        parseSession?: { allianceId?: string | null };
        rows?: Array<ParsedRow & { scoreConflict?: number }>;
      };
      if (!res.ok) {
        setError(data.error ?? tc("uploadFailed"));
        return;
      }

      if (data.alliance?.stale && !options?.skipRematch) {
        const ok = await rematchMembers();
        if (ok) {
          await loadRef.current({ skipRematch: true });
          return;
        }
      }

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
      setScoreTargetMeta(data.scoreTargetMeta ?? null);
      if (data.job?.hqEventId) {
        setHqEventId(data.job.hqEventId);
      }
      if (data.job?.boardKey) {
        setBoardKey(data.job.boardKey);
      }
      setAllianceId(
        data.alliance?.currentId ??
          data.job?.allianceId ??
          data.parseSession?.allianceId ??
          null,
      );
      setAllianceTag(
        data.alliance?.jobTag ?? data.alliance?.currentTag ?? null,
      );
      setAllianceName(data.alliance?.jobName ?? null);
      setAllianceStale(Boolean(data.alliance?.stale));
      setRows(
        (data.rows ?? []).map((row) => ({
          ...row,
          scoreConflict: row.scoreConflict ?? 0,
        })),
      );
    },
    [jobId, rematchMembers, tc],
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
      "complete",
      "discarded",
    ]);
    if (terminalStatuses.has(jobStatus)) {
      return jobStatus;
    }
    if (
      liveJob &&
      (liveJob.status === "queued" ||
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

    if (liveJob.status === "review" || liveJob.status === "failed") {
      queueMicrotask(() => {
        void load();
      });
    }
  }, [liveJob, load]);

  useEffect(() => {
    rosterMembersHydratedRef.current = false;
  }, [jobId]);

  useEffect(() => {
    async function fetchMembers() {
      if (scoreTargetMeta?.showRosterColumns) {
        const res = await fetch("/api/members");
        if (!res.ok) return;
        const data = (await res.json()) as AllianceMembersPayload;
        setRosterMembers(data.members);
        if (data.alliance.tag) {
          setAllianceTag(data.alliance.tag);
        }
        if (data.alliance.name) {
          setAllianceName(data.alliance.name);
        }
        if (!rosterMembersHydratedRef.current) {
          rosterMembersHydratedRef.current = true;
          setRows((prev) => {
            const mapped = parsedRowsToRosterReviewRows(
              prev,
              data.members,
              data.alliance.tag,
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
        }
        return;
      }

      if (!allianceId) return;
      const q = encodeURIComponent(JSON.stringify({ alliance_id: allianceId }));
      const res = await fetch(`/api/bff/v1/entities/Member?q=${q}&sort=current_name`);
      if (res.ok) {
        const data = (await res.json()) as MemberOption[];
        setMembers(
          [...data].sort((a, b) =>
            a.current_name.localeCompare(b.current_name),
          ),
        );
      }
    }
    void fetchMembers();
  }, [allianceId, scoreTargetMeta?.showRosterColumns]);

  const eventTypeLabel = scoreTargetMeta?.labelKey
    ? tNav(scoreTargetMeta.labelKey)
    : "";

  useEffect(() => {
    async function fetchEvents() {
      if (!allianceId || !scoreTargetMeta) return;

      if (scoreTargetMeta.usesHqEvents) {
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

      const q = encodeURIComponent(JSON.stringify({ alliance_id: allianceId }));
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
        }));
        setEvents(list);
        if (list[0] && !eventId) {
          setEventId(list[0].id);
        }
      }
    }
    void fetchEvents();
  }, [
    allianceId,
    scoreTargetMeta,
    eventId,
    hqEventId,
    eventTypeLabel,
    locale,
    timezoneId,
  ]);

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
    async (patch: { selectedJobId?: string; accuracyJobId?: string }) => {
      if (!groupInfo?.group) return false;
      const res = await fetch(`/api/tools/video-upload/groups/${groupInfo.group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? tc("uploadFailed"));
        return false;
      }
      return true;
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
    const ok = await updateGroupSelection({ selectedJobId: recommendedId });
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
    })),
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


  const canSubmit =
    activeRows.length > 0 &&
    eventGateSatisfied &&
    (!needsBoardPicker || boardKey) &&
    !hasDuplicateMembers &&
    !hasDuplicateOcrNames &&
    !submitting &&
    !(
      scoreTargetMeta?.maxSubmitRows != null &&
      activeRows.length > scoreTargetMeta.maxSubmitRows
    ) &&
    (scoreTargetMeta?.showRosterColumns
      ? rosterQuotaCanSubmit
      : true);

  function updateRosterRow(id: string, patch: Partial<ParsedRow>) {
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
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function deleteRow(id: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, deleted: 1 } : r)),
    );
  }

  async function handleSubmit() {
    if (hasDuplicateMembers || hasDuplicateOcrNames) {
      setError(t("duplicateMemberBlocked"));
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const isRoster = scoreTargetMeta?.showRosterColumns;
      const res = await fetch(`/api/tools/video-upload/${jobId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: scoreTargetMeta?.usesHqEvents ? undefined : eventId,
          hqEventId: scoreTargetMeta?.usesHqEvents ? hqEventId : undefined,
          boardKey: needsBoardPicker ? boardKey : undefined,
          team: scoreTargetMeta?.showTeamSelector ? team : undefined,
          recordedDate,
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
        setError(data.error ?? tc("uploadFailed"));
        return;
      }
      setSuccess(
        isEventView
          ? t("updateSuccess", { count: data.submitted ?? 0 })
          : scoreTargetMeta?.showRosterColumns
            ? t("rosterSubmitSuccess", { count: data.submitted ?? 0 })
            : t("submitSuccess", { count: data.submitted ?? 0 }),
      );
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
      } else if (!jobRating) {
        setShowRatingPrompt(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function reprocess() {
    setReprocessing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/reprocess`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? tc("uploadFailed"));
        return;
      }
      setRows([]);
      setJobStatus("queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setReprocessing(false);
    }
  }

  async function handleDiscard() {
    setDiscarding(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/discard`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? tc("uploadFailed"));
        return;
      }
      setJobStatus("discarded");
      if (!jobRating) {
        setShowRatingPrompt(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
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
        setError(data.error ?? tc("uploadFailed"));
        return false;
      }
      return true;
    } catch (err) {
      setJobRating(null);
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
      return false;
    }
  }

  async function handleAddRow(position: ManualRowPosition) {
    const res = await fetch(`/api/tools/video-upload/${jobId}/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { row: ParsedRow };
    setRows((prev) =>
      mergeParsedRowInReviewOrder(prev, data.row, scoreTargetMeta?.id),
    );
  }

  if (displayJobStatus === "loading" || rematching) {
    return (
      <p className="text-sm text-[#8b949e]">
        {rematching ? t("rematchingMembers") : t("loading")}
      </p>
    );
  }

  if (
    reprocessing ||
    displayJobStatus === "queued" ||
    displayJobStatus === "extracting" ||
    displayJobStatus === "parsing"
  ) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#8b949e]">
          {reprocessing
            ? t("reprocessing")
            : t("processing", { status: displayJobStatus })}
        </p>
        <Link href="/tools/video-upload" className="text-sm text-[#58a6ff] hover:underline">
          {t("backToUploads")}
        </Link>
      </div>
    );
  }

  if (displayJobStatus === "failed") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#f85149]">{t("processingFailed")}</p>
        <Link href="/tools/video-upload" className="text-sm text-[#58a6ff] hover:underline">
          {t("backToUploads")}
        </Link>
      </div>
    );
  }

  const showSidePreview = previewOpen && previewPlacement === "side";
  const showTopPreview = previewOpen && previewPlacement === "top";
  const showBottomPreview = previewOpen && previewPlacement === "bottom";
  const previewNode = previewOpen ? (
    <ReviewVideoPreview
      jobId={jobId}
      placement={previewPlacement}
      available={previewPlacements}
      onPlacementChange={setPreviewPlacement}
      onClose={() => setPreviewOpen(false)}
      unavailable={!hasSourceVideo}
      seekRequest={previewSeekRequest}
    />
  ) : null;

  return (
    <div
      className={`relative flex min-w-0 w-full max-w-full ${
        showSidePreview ? "flex-row" : "flex-col"
      }`}
    >
      {showTopPreview ? previewNode : null}
      <div
        className="min-w-0 flex flex-1 flex-col"
        style={
          showBottomPreview ? { paddingBottom: PREVIEW_DOCK_HEIGHT } : undefined
        }
      >
        <div className="mx-auto min-w-0 w-full max-w-5xl flex-1 space-y-6 px-4 pb-6 md:px-0">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Link
            href="/tools/video-upload"
            className="text-sm text-[#58a6ff] hover:underline"
          >
            {t("backToUploads")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {canComparePasses ? (
              <button
                type="button"
                onClick={openComparisonSheet}
                className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#e6edf3] hover:bg-[#21262d]"
              >
                {t("comparisonSideBySide")}
              </button>
            ) : null}
            {hasSourceVideo ? (
              <button
                type="button"
                onClick={() => setPreviewOpen((open) => !open)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  previewOpen
                    ? "border-[#58a6ff] text-[#58a6ff]"
                    : "border-[#30363d] text-[#e6edf3] hover:bg-[#21262d]"
                }`}
              >
                {t("previewVideo")}
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
        <p className="mt-1 text-sm text-[#8b949e]">
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

      {activeRows.length === 0 && !isEventView && (
        <div className="rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-4 text-sm">
          <p className="text-[#e3b341]">{t("noEntriesHint")}</p>
          <button
            type="button"
            onClick={() => void reprocess()}
            disabled={reprocessing}
            className="mt-3 rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {reprocessing ? t("reprocessing") : t("reprocess")}
          </button>
        </div>
      )}

      {hasScoreConflicts && (
        <div className="rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-4 text-sm text-[#e3b341]">
          <p>{t("scoreConflictHint")}</p>
        </div>
      )}

      {hasDuplicateMembers && (
        <div className="rounded-xl border border-[#f85149]/40 bg-[#f8514915] p-4 text-sm text-[#f85149]">
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
          <p className="mt-2 text-[#e6edf3]">{t("duplicateMemberHint")}</p>
        </div>
      )}

      {hasDuplicateOcrNames && (
        <div className="rounded-xl border border-[#f85149]/40 bg-[#f8514915] p-4 text-sm text-[#f85149]">
          <p>{t("duplicateOcrNameRow")}</p>
        </div>
      )}

      {showComparisonPrompt &&
        !isEventView &&
        groupInfo?.group &&
        !showComparisonSheet ? (
        <div className="rounded-xl border border-[#58a6ff] bg-[#58a6ff10] p-4">
          <p className="font-medium text-[#e6edf3]">{t("comparisonPromptTitle")}</p>
          <p className="mt-1 text-sm text-[#8b949e]">{t("comparisonPromptBody")}</p>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleUseBetterPass()}
                className="rounded-lg border border-[#238636] bg-[#238636] px-3 py-1.5 text-sm text-white"
              >
                {t("comparisonUseBetter")}
              </button>
              <button
                type="button"
                onClick={openComparisonSheet}
                className="hidden rounded-lg border border-[#30363d] px-3 py-1.5 text-sm hover:bg-[#21262d] sm:inline-flex"
              >
                {t("comparisonSideBySide")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowComparisonPrompt(false);
                  setComparisonDismissed(true);
                }}
                className="text-sm text-[#8b949e] hover:text-[#e6edf3]"
              >
                {t("comparisonDismiss")}
              </button>
            </div>
            <button
              type="button"
              onClick={openComparisonSheet}
              className="self-start text-sm text-[#58a6ff] hover:underline sm:hidden"
            >
              {t("comparisonSideBySide")}
            </button>
          </div>
        </div>
      ) : null}

      {!scoreTargetMeta?.showRosterColumns ? (
      <div className="grid gap-4 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:grid-cols-3">
        {needsEventPicker ? (
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-[#8b949e]">{t("eventLabel")}</span>
            {/* Non-HQ event target with no existing events: show an
                auto-create note instead of a broken empty dropdown.
                The server will provision an event entity automatically. */}
            {!scoreTargetMeta?.usesHqEvents && events.length === 0 ? (
              <p className="mt-1 text-xs text-[#8b949e] max-w-xs">
                {t("noEventsAutoCreate")}
              </p>
            ) : (
              <AppSelect
                value={scoreTargetMeta?.usesHqEvents ? hqEventId : eventId}
                onChange={(next) => {
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
                className="mt-2 text-xs text-[#58a6ff] hover:underline"
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
            <span className="mb-1 block text-[#8b949e]">{t("boardLabel")}</span>
            <AppSelect
              value={boardKey}
              onChange={setBoardKey}
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
          <label className="block text-sm">
            <span className="mb-1 block text-[#8b949e]">{t("teamLabel")}</span>
            <AppSelect
              value={team}
              onChange={(next) => setTeam(next as "A" | "B")}
              aria-label={t("teamLabel")}
              options={[
                { value: "A", label: "Team A" },
                { value: "B", label: "Team B" },
              ]}
            />
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="mb-1 block text-[#8b949e]">{t("dateLabel")}</span>
          <input
            type="date"
            value={recordedDate}
            onChange={(e) => setRecordedDate(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          />
        </label>
      </div>
      ) : null}

      {scoreTargetMeta?.showRosterColumns ? (
        <>
          <div className="flex items-center gap-3">
            <input
              type="search"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("filterPlaceholder")}
              className="flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm placeholder:text-[#8b949e]"
            />
            {filterQuery ? (
              <p className="shrink-0 text-xs text-[#8b949e]">
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
              deleted: row.deleted,
            }))}
            members={rosterMembers}
            filterQuery={filterQuery}
            duplicateRowIds={duplicateRowIds}
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
      ) : (
        <>
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={t("filterPlaceholder")}
          className="flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm placeholder:text-[#8b949e]"
        />
        {filterQuery && (
          <p className="shrink-0 text-xs text-[#8b949e]">
            {t("filterCount", {
              shown: filteredRows.length,
              total: activeRows.length,
            })}
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleAddRow("start")}
          className="shrink-0 rounded-lg border border-[#30363d] px-3 py-2 text-sm hover:bg-[#21262d]"
        >
          {t("addRow")}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#30363d]">
        <table className="min-w-full text-sm">
          <thead className="bg-[#161b22] text-left text-[#8b949e]">
            <tr>
              <th className="px-4 py-3">{t("colName")}</th>
              <th className="px-4 py-3">{t("colMember")}</th>
              {scoreTargetMeta?.showRosterColumns ? (
                <>
                  <th className="px-4 py-3">{t("colAllianceRank")}</th>
                  <th className="px-4 py-3">{t("colPower")}</th>
                  <th className="px-4 py-3">{t("colLevel")}</th>
                  <th className="px-4 py-3">{t("colProfession")}</th>
                </>
              ) : null}
              {scoreTargetMeta?.showRankColumn ? (
                <th className="px-4 py-3">{t("colRank")}</th>
              ) : null}
              {scoreTargetMeta?.showScoreColumn !== false ? (
                <th className="px-4 py-3">{t("colScore")}</th>
              ) : null}
              <th className="px-4 py-3" />
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
                ? "border-t border-[#30363d] bg-[#f8514910]"
                : row.scoreConflict
                  ? "border-t border-[#30363d] bg-[#d2992210]"
                  : "border-t border-[#30363d]";

              return (
              <tr key={row.id} className={rowClass}>
                <td className="px-4 py-3 font-medium">
                  <div>{row.ocrName}</div>
                  {row.scoreConflict ? (
                    <p className="mt-1 text-xs text-[#d29922]">
                      {t("scoreConflictRow")}
                    </p>
                  ) : null}
                  {isDuplicateMember ? (
                    <p className="mt-1 text-xs text-[#f85149]">
                      {t("duplicateMemberRow")}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
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
                    searchPlaceholder={tMembers("searchPlaceholder")}
                    noSearchResultsLabel={t("memberSearchNoResults")}
                    options={buildMemberMatchSelectOptions(members, {
                      emptyLabel: t("unmatched"),
                      highlightMemberId: row.memberId,
                      highlightConfidence: row.matchConfidence,
                    })}
                  />
                </td>
                {scoreTargetMeta?.showRosterColumns ? (
                  <>
                    <td className="px-4 py-3">
                      {row.rosterRankRaw ??
                        (row.allianceRank != null ? `R${row.allianceRank}` : "—")}
                      {row.allianceRankTitle ? (
                        <p className="mt-1 text-xs text-[#8b949e]">
                          {row.allianceRankTitle}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{row.powerLevel ?? "—"}</td>
                    <td className="px-4 py-3">
                      {row.memberLevel != null ? row.memberLevel : "—"}
                    </td>
                    <td className="px-4 py-3">{row.profession ?? "—"}</td>
                  </>
                ) : null}
                {scoreTargetMeta?.showRankColumn ? (
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={row.rank ?? ""}
                      onChange={(e) =>
                        updateRow(row.id, {
                          rank: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                      className="w-16 rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-1.5"
                    />
                  </td>
                ) : null}
                {scoreTargetMeta?.showScoreColumn !== false ? (
                <td className="px-4 py-3">
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
                          value={row.score ?? ""}
                          onChange={(e) =>
                            updateRow(row.id, { score: e.target.value })
                          }
                          className={`w-28 rounded-lg border bg-[#0d1117] px-2 py-1.5 ${
                            isNegative
                              ? "border-[#f85149]"
                              : showZeroWarning
                                ? "border-[#d29922]"
                                : "border-[#30363d]"
                          }`}
                        />
                        {showZeroWarning && (
                          <p className="mt-1 text-xs text-[#d29922]">
                            {t("scoreZeroWarning")}
                          </p>
                        )}
                        {isNegative && (
                          <p className="mt-1 text-xs text-[#f85149]">
                            {t("scoreNegativeWarning")}
                          </p>
                        )}
                      </>
                    );
                  })()}
                </td>
                ) : null}
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                    {rowCanVideoPreview ? (
                      <button
                        type="button"
                        onClick={() => openRowVideoPreview(row)}
                        className="inline-flex items-center gap-1.5 text-[#58a6ff] hover:underline"
                        aria-label={t("rowVideoPreview")}
                      >
                        <Video className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="hidden sm:inline">
                          {t("rowVideoPreview")}
                        </span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => deleteRow(row.id)}
                      className="text-[#f85149] hover:underline"
                    >
                      {t("deleteRow")}
                    </button>
                  </div>
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
          onClick={() => void handleAddRow("end")}
          className="rounded-lg border border-[#30363d] px-3 py-2 text-sm hover:bg-[#21262d]"
        >
          {t("addRow")}
        </button>
      </div>
        </>
      )}

      {error && <p className="text-sm text-[#f85149]">{error}</p>}
      {success && <p className="text-sm text-[#3fb950]">{success}</p>}

      <div className="flex flex-wrap gap-3">
        <Link
          href="/tools/video-upload"
          className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:bg-[#21262d]"
        >
          {tc("back")}
        </Link>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting
            ? t("submitting")
            : scoreTargetMeta?.showRosterColumns
              ? t("saveRoster", { count: activeRows.length })
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
          className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514910] disabled:opacity-50"
        >
          {discarding ? tc("loading") : t("discardResults")}
        </button>
        ) : null}
      </div>

      {showRatingPrompt ? (
        <OcrRatingPrompt
          onClose={() => setShowRatingPrompt(false)}
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
              const ok = await updateGroupSelection({ selectedJobId });
              if (!ok) return;
              setShowComparisonSheet(false);
              setShowComparisonPrompt(false);
              setComparisonDismissed(true);
              window.location.href = `/tools/video-upload/${selectedJobId}/review`;
            })();
          }}
          onAccuracyVote={(accuracyJobId: string) => {
            void updateGroupSelection({ accuracyJobId });
          }}
        />
      ) : null}
        </div>
      </div>
      {showSidePreview ? previewNode : null}
      {showBottomPreview ? previewNode : null}
    </div>
  );
}
