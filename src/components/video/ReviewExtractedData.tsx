"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";
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
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import { isVideoProcessTimings } from "@/lib/video/pipeline-stats-display";
import { VideoPipelineStatsButton } from "@/components/video/VideoPipelineStatsDialog";
import { accountTodayCalendarDate } from "@/lib/timezone/format";

type ParsedRow = {
  id: string;
  ocrName: string;
  score: string;
  rank: number | null;
  memberId: string | null;
  memberName: string | null;
  matchConfidence: number | null;
  matchMethod: string | null;
  scoreConflict: number;
  deleted: number;
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
};

type Props = {
  jobId: string;
};

function confidenceClass(confidence: number | null): string {
  if (confidence == null || confidence === 0) return "border-[#f85149]";
  if (confidence >= 0.9) return "border-[#3fb950]";
  if (confidence >= 0.6) return "border-[#d29922]";
  return "border-[#f85149]";
}

export function ReviewExtractedData({ jobId }: Props) {
  const t = useTranslations("videoReview");
  const tc = useTranslations("common");
  const tNav = useTranslations("nav");
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [timings, setTimings] = useState<VideoProcessTimings | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

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
          timingsJson?: VideoProcessTimings | null;
        };
        scoreTargetMeta?: ScoreTargetMeta | null;
        alliance?: {
          currentId?: string | null;
          currentTag?: string | null;
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
      setFileName(data.job?.fileName ?? null);
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
      setRows(
        (data.rows ?? [])
          .filter((r) => !r.deleted)
          .map((row) => ({
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
    async function fetchMembers() {
      if (!allianceId) return;
      const q = encodeURIComponent(JSON.stringify({ alliance_id: allianceId }));
      const res = await fetch(`/api/bff/v1/entities/Member?q=${q}&sort=current_name`);
      if (res.ok) {
        const data = (await res.json()) as MemberOption[];
        setMembers(data);
      }
    }
    void fetchMembers();
  }, [allianceId]);

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

  const activeRows = useMemo(
    () => rows.filter((r) => !r.deleted),
    [rows],
  );

  const matchedCount = activeRows.filter((r) => r.memberId).length;

  const duplicateMemberIssues = useMemo(
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

  const duplicateRowIds = useMemo(
    () => duplicateMemberRowIds(duplicateMemberIssues),
    [duplicateMemberIssues],
  );

  const hasScoreConflicts = activeRows.some((row) => row.scoreConflict);
  const hasDuplicateMembers = duplicateMemberIssues.length > 0;
  const needsEventPicker =
    scoreTargetMeta?.usesHqEvents ||
    Boolean(scoreTargetMeta?.eventEntity);
  const needsBoardPicker =
    scoreTargetMeta?.leaderboardModel === "multi-board";
  const selectedEventId = scoreTargetMeta?.usesHqEvents ? hqEventId : eventId;

  const canSubmit =
    activeRows.length > 0 &&
    (!needsEventPicker || selectedEventId) &&
    (!needsBoardPicker || boardKey) &&
    !hasDuplicateMembers &&
    !submitting &&
    !(
      scoreTargetMeta?.maxSubmitRows != null &&
      activeRows.length > scoreTargetMeta.maxSubmitRows
    );

  function updateRow(id: string, patch: Partial<ParsedRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSubmit() {
    if (hasDuplicateMembers) {
      setError(t("duplicateMemberBlocked"));
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: scoreTargetMeta?.usesHqEvents ? undefined : eventId,
          hqEventId: scoreTargetMeta?.usesHqEvents ? hqEventId : undefined,
          boardKey: needsBoardPicker ? boardKey : undefined,
          team: scoreTargetMeta?.showTeamSelector ? team : undefined,
          recordedDate,
          rows: activeRows.map((r) => ({
            id: r.id,
            memberId: r.memberId,
            memberName: r.memberName ?? r.ocrName,
            score: r.score,
            rank: r.rank,
            deleted: false,
          })),
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
      setSuccess(t("submitSuccess", { count: data.submitted ?? 0 }));
      setJobStatus("complete");
      if (data.showSolicitedFeedback && data.solicitedSource) {
        showExperienceFeedback({
          videoJobId: jobId,
          source: data.solicitedSource,
          isSolicited: true,
          delayMs: 1500,
        });
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
      setJobStatus("extracting");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("uploadFailed"));
    } finally {
      setReprocessing(false);
    }
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Link
            href="/tools/video-upload"
            className="text-sm text-[#58a6ff] hover:underline"
          >
            {t("backToUploads")}
          </Link>
          <VideoPipelineStatsButton timings={timings} fileName={fileName} />
        </div>
        <h1 className="mt-2 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">
          {t("summary", {
            matched: matchedCount,
            total: activeRows.length,
          })}
        </p>
      </div>

      {activeRows.length === 0 && (
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

      <div className="grid gap-4 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:grid-cols-3">
        {needsEventPicker ? (
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-[#8b949e]">{t("eventLabel")}</span>
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

      <div className="overflow-x-auto rounded-xl border border-[#30363d]">
        <table className="min-w-full text-sm">
          <thead className="bg-[#161b22] text-left text-[#8b949e]">
            <tr>
              <th className="px-4 py-3">{t("colName")}</th>
              <th className="px-4 py-3">{t("colMember")}</th>
              {scoreTargetMeta?.showRankColumn ? (
                <th className="px-4 py-3">{t("colRank")}</th>
              ) : null}
              <th className="px-4 py-3">{t("colScore")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {activeRows.map((row) => {
              const isDuplicateMember = duplicateRowIds.has(row.id);
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
                    triggerClassName={`px-2 py-1.5 ${confidenceClass(row.matchConfidence)}`}
                    options={[
                      { value: "", label: t("unmatched") },
                      ...members.map((m) => ({
                        value: m.id,
                        label: `${m.current_name}${
                          row.memberId === m.id &&
                          row.matchConfidence != null &&
                          row.matchConfidence < 1
                            ? ` (${Math.round(row.matchConfidence * 100)}%)`
                            : ""
                        }`,
                      })),
                    ]}
                  />
                </td>
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
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={row.score}
                    onChange={(e) => updateRow(row.id, { score: e.target.value })}
                    className="w-28 rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-1.5"
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => deleteRow(row.id)}
                    className="text-[#f85149] hover:underline"
                  >
                    {t("deleteRow")}
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-[#f85149]">{error}</p>}
      {success && <p className="text-sm text-[#3fb950]">{success}</p>}

      <div className="flex gap-3">
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
            : t("saveScores", { count: activeRows.length })}
        </button>
      </div>
    </div>
  );
}
