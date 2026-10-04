"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppSelect } from "@/components/ui/AppSelect";
import { Link } from "@/i18n/navigation";
import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";
import { formatEventScore } from "@/lib/hq-events/workspace.shared";
import {
  type EventUploadContext,
  type WarzoneReviewEvidenceKind,
} from "@/lib/video/warzone-evidence.shared";

type MemberOption = {
  id: string;
  current_name: string;
  previous_names?: string[];
};

type RowEventEvidence = {
  kind?: string | null;
  pollOption?: number | null;
  crop?: { left: number; top: number; width: number; height: number } | null;
  frameIndex?: number | null;
  videoTimestampSeconds?: number | null;
  formatMismatch?: boolean;
  unresolvedOption?: boolean;
};

type JobRow = {
  id: string;
  ocrName: string | null;
  score: string | null;
  rank: number | null;
  frameIndex: number | null;
  memberId: string | null;
  memberName: string | null;
  deleted: number;
  eventEvidence?: RowEventEvidence | null;
};

type ReviewRow = {
  rowId: string;
  ocrName: string;
  memberId: string | null;
  memberName: string | null;
  kind: WarzoneReviewEvidenceKind;
  realScore: string;
  observedRank: string;
  excluded: boolean;
  edited: boolean;
  correctionReason: string;
  evidence: RowEventEvidence | null;
};

type JobPayload = {
  job?: {
    id: string;
    status: string;
    fileName?: string | null;
    scoreTarget?: string | null;
    eventContext?: EventUploadContext | null;
  };
  rows?: JobRow[];
  members?: MemberOption[];
};

function isPollKind(kind: WarzoneReviewEvidenceKind): boolean {
  return kind === "poll_yes" || kind === "poll_no";
}

function toReviewRow(row: JobRow): ReviewRow {
  const evidence = row.eventEvidence ?? null;
  const rawKind = evidence?.kind;
  const kind: WarzoneReviewEvidenceKind =
    rawKind === "poll_yes" || rawKind === "poll_no" || rawKind === "leaderboard"
      ? rawKind
      : "leaderboard";
  return {
    rowId: row.id,
    ocrName: row.ocrName ?? "",
    memberId: row.memberId,
    memberName: row.memberName,
    kind,
    realScore: kind === "leaderboard" ? (row.score ?? "") : "",
    observedRank: row.rank != null ? String(row.rank) : "",
    excluded: row.deleted === 1,
    edited: false,
    correctionReason: "",
    evidence,
  };
}

function frameCropSrc(
  jobId: string,
  evidence: RowEventEvidence | null,
): string | null {
  const crop = evidence?.crop;
  const frameIndex = evidence?.frameIndex;
  if (!crop || frameIndex == null) return null;
  return `/api/tools/video-jobs/${jobId}/frames/${frameIndex}?crop=${crop.left},${crop.top},${crop.width},${crop.height}`;
}

type SyncSummary = {
  status: string;
  synced: number;
  pending: number;
  conflict: number;
  failed: number;
  uncertain: number;
  unsupported: number;
} | null;

/** Ashed status line for the save confirmation, worst-case first. */
function syncStatusKey(sync: NonNullable<SyncSummary>): string {
  if (sync.conflict > 0) return "syncConflict";
  if (sync.uncertain > 0) return "syncUncertain";
  if (sync.unsupported > 0) return "precisionUnsupported";
  if (sync.failed > 0 || sync.status === "connection_required")
    return "syncFailed";
  if (sync.pending > 0 || sync.status === "partial") return "syncPending";
  return "synced";
}

type Props = {
  jobId: string;
};

/**
 * Warzone event-evidence review: cropped source, OCR name, member match,
 * evidence kind, editable score/rank for leaderboard rows, fixed poll
 * participation credits, poll-option confirmation, and a single idempotent
 * save through `commitReviewedEventEvidence`.
 */
export function EventEvidenceReview({ jobId }: Props) {
  const t = useTranslations("videoReview");
  const tEvent = useTranslations("eventEvidence");
  const tMembers = useTranslations("members");
  const tCommon = useTranslations("common");
  const tTrains = useTranslations("trains.wheel");
  const tSettings = useTranslations("settings");
  const tActions = useTranslations("vsPerformance.actions");
  const locale = useLocale();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [eventContext, setEventContext] = useState<EventUploadContext | null>(
    null,
  );
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [pollConfirmed, setPollConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sync, setSync] = useState<SyncSummary>(null);
  const [syncRetrying, setSyncRetrying] = useState(false);
  const requestIdRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tools/video-upload/${jobId}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as JobPayload | null;
        if (!res.ok || !body?.job) throw new Error("load_failed");
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setEventContext(body.job?.eventContext ?? null);
        setMembers(body.members ?? []);
        setRows(
          (body.rows ?? [])
            .filter((row) => row.deleted !== 1)
            .map(toReviewRow),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const memberOptions = useMemo(
    () =>
      buildMemberMatchSelectOptions(members, {
        emptyLabel: tEvent("unmatchedMember"),
        selectedMembers: rows.map((row) => ({
          memberId: row.memberId,
          memberName: row.memberName,
        })),
      }),
    [members, rows, tEvent],
  );
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.id, member.current_name);
    for (const row of rows) {
      if (row.memberId && row.memberName) map.set(row.memberId, row.memberName);
    }
    return map;
  }, [members, rows]);

  const activeRows = rows.filter((row) => !row.excluded);
  const hasPollRows = activeRows.some((row) => isPollKind(row.kind));
  const hasUnresolvedPoll = activeRows.some(
    (row) => row.evidence?.unresolvedOption === true,
  );
  const hasUnmatched = activeRows.some((row) => !row.memberId);
  const invalidScores = activeRows.some(
    (row) =>
      row.kind === "leaderboard" &&
      (!row.realScore || !/^\d+$/.test(row.realScore)),
  );
  const missingReason = activeRows.some(
    (row) => row.edited && !row.correctionReason.trim(),
  );

  const canSubmit =
    !submitting &&
    activeRows.length > 0 &&
    !hasUnresolvedPoll &&
    !hasUnmatched &&
    !invalidScores &&
    !missingReason &&
    (!hasPollRows || pollConfirmed);

  function updateRow(rowId: string, patch: Partial<ReviewRow>) {
    setRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
    );
  }

  async function handleSave() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: requestIdRef.current,
          pollOptionsConfirmed: pollConfirmed,
          rows: rows.map((row) => ({
            rowId: row.rowId,
            memberId: row.memberId,
            memberName: row.memberId
              ? (memberNameById.get(row.memberId) ?? row.memberName)
              : null,
            kind: row.kind,
            realScore: isPollKind(row.kind) ? null : row.realScore || null,
            observedRank: row.observedRank
              ? Number.parseInt(row.observedRank, 10)
              : null,
            pollOption: row.evidence?.pollOption ?? null,
            excluded: row.excluded,
            correctionReason: row.correctionReason.trim() || null,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = typeof body?.error === "string" ? body.error : "failed";
        setSubmitError(
          code === "unknown_poll_option"
            ? tEvent("unknownPollOption")
            : code === "poll_options_unconfirmed"
              ? tEvent("confirmPollOptions")
              : code === "unmatched_member"
                ? tEvent("unmatchedMember")
                : code === "invalid_score"
                  ? tEvent("realScore")
                  : tEvent("actionFailed"),
        );
        return;
      }
      setSync((body?.sync as SyncSummary) ?? null);
      setSaved(true);
    } catch {
      setSubmitError(tEvent("actionFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-hq-fg-muted" role="status">
        {tCommon("loading")}
      </p>
    );
  }
  if (loadError) {
    return (
      <p className="text-sm text-hq-danger" role="alert">
        {tEvent("actionFailed")}
      </p>
    );
  }

  async function handleSyncRetry() {
    if (!eventContext?.eventId || syncRetrying) return;
    setSyncRetrying(true);
    try {
      const res = await fetch(`/api/hq-events/${eventContext.eventId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.sync) setSync(body.sync as SyncSummary);
    } finally {
      setSyncRetrying(false);
    }
  }

  if (saved) {
    const showAshedStatus = sync != null && sync.status !== "not_configured";
    const syncKey = showAshedStatus ? syncStatusKey(sync) : null;
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4 sm:p-5">
        <h1 className="text-xl font-semibold">{tEvent("eventSaved")}</h1>
        {showAshedStatus ? (
          <div className="flex flex-wrap items-center gap-3">
            <p
              className={`text-sm ${
                syncKey === "synced" ? "text-hq-fg-muted" : "text-hq-warning"
              }`}
            >
              {tEvent(syncKey!)}
            </p>
            {sync.status === "connection_required" ? (
              <Link
                href="/settings"
                className="text-sm text-hq-accent hover:underline"
              >
                {tSettings("connectAshedCta")}
              </Link>
            ) : (
              <button
                type="button"
                disabled={syncRetrying}
                onClick={() => void handleSyncRetry()}
                className="text-sm text-hq-accent hover:underline disabled:opacity-50"
              >
                {tActions("retry")}
              </button>
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          {eventContext?.eventId ? (
            <Link
              href={`/events/${eventContext.eventId}`}
              className="text-sm text-hq-accent hover:underline"
            >
              {tEvent("reviewEvent")}
            </Link>
          ) : null}
          <Link
            href={
              eventContext?.eventId
                ? `/trains?eventId=${eventContext.eventId}`
                : "/trains"
            }
            className="text-sm text-hq-accent hover:underline"
          >
            {tEvent("returnToTrain")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <Link
          href="/tools/video-upload"
          className="text-sm text-hq-accent hover:underline"
        >
          {t("backToUploads")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{tEvent("title")}</h1>
      </div>

      {hasUnresolvedPoll ? (
        <p className="rounded-lg border border-hq-warning/50 bg-hq-warning/10 p-3 text-sm text-hq-warning">
          {tEvent("unknownPollOption")}
        </p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const cropSrc = frameCropSrc(jobId, row.evidence);
          const isPoll = isPollKind(row.kind);
          return (
            <li
              key={row.rowId}
              className={`rounded-xl border border-hq-border bg-hq-surface p-3 ${
                row.excluded ? "opacity-50" : ""
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                {cropSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cropSrc}
                    alt={tEvent("imagePreviewAlt")}
                    className="max-h-16 w-auto rounded border border-hq-border"
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-sm font-medium">
                      {row.ocrName}
                    </span>
                    <span className="rounded-full bg-hq-selected px-2 py-0.5 text-xs text-hq-selected-fg">
                      {row.kind === "leaderboard"
                        ? tEvent("leaderboardEvidence")
                        : row.kind === "poll_yes"
                          ? tEvent("pollYes")
                          : tEvent("pollNo")}
                    </span>
                    {isPoll && row.evidence?.pollOption ? (
                      <span className="text-xs text-hq-fg-muted">
                        {tEvent("detectedPollOption", {
                          option: row.evidence.pollOption,
                        })}
                      </span>
                    ) : null}
                    {row.evidence?.unresolvedOption ? (
                      <span className="text-xs text-hq-danger">
                        {tEvent("unknownPollOption")}
                      </span>
                    ) : null}
                    {row.evidence?.formatMismatch ? (
                      <span className="text-xs text-hq-warning">
                        {tEvent("conflictingEvidence")}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-hq-fg-muted">
                        {tEvent("matchedMember")}
                      </span>
                      <AppSelect
                        value={row.memberId ?? ""}
                        onChange={(memberId) =>
                          updateRow(row.rowId, {
                            memberId: memberId || null,
                            memberName: memberId
                              ? (memberNameById.get(memberId) ?? null)
                              : null,
                            edited: true,
                          })
                        }
                        options={memberOptions}
                        searchable
                        searchPlaceholder={tMembers("search")}
                        aria-label={tEvent("matchedMember")}
                      />
                      {!row.memberId ? (
                        <p className="mt-1 text-xs text-hq-danger">
                          {tEvent("unmatchedMember")}
                        </p>
                      ) : null}
                    </label>

                    {isPoll ? (
                      <div>
                        <span className="mb-1 block text-xs text-hq-fg-muted">
                          {tEvent("participationCredit")}
                        </span>
                        <p className="text-sm">
                          {formatEventScore(
                            row.kind === "poll_yes" ? "1000" : "1",
                            locale,
                          )}
                        </p>
                        <p className="mt-1 text-xs text-hq-fg-muted">
                          {tEvent("pollCreditHint")}
                        </p>
                      </div>
                    ) : (
                      <>
                        <label className="block">
                          <span className="mb-1 block text-xs text-hq-fg-muted">
                            {tEvent("realScore")}
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={row.realScore}
                            onChange={(event) =>
                              updateRow(row.rowId, {
                                realScore: event.target.value.trim(),
                                edited: true,
                              })
                            }
                            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-hq-fg-muted">
                            {tEvent("observedRank")}
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={row.observedRank}
                            onChange={(event) =>
                              updateRow(row.rowId, {
                                observedRank: event.target.value.trim(),
                                edited: true,
                              })
                            }
                            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-2 py-1.5 text-sm"
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {row.edited ? (
                    <label className="block">
                      <span className="mb-1 block text-xs text-hq-fg-muted">
                        {tTrains("overrideReasonLabel")}
                      </span>
                      <input
                        type="text"
                        value={row.correctionReason}
                        onChange={(event) =>
                          updateRow(row.rowId, {
                            correctionReason: event.target.value,
                          })
                        }
                        placeholder={tTrains("overrideReasonPlaceholder")}
                        className="w-full rounded-lg border border-hq-border bg-hq-canvas px-2 py-1.5 text-sm"
                      />
                    </label>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    updateRow(row.rowId, { excluded: !row.excluded })
                  }
                  className="rounded-lg border border-hq-border px-2 py-1 text-xs text-hq-fg hover:bg-hq-surface-muted"
                >
                  {tEvent("excludeRow")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {hasPollRows ? (
        <label className="flex items-start gap-2 rounded-lg border border-hq-border bg-hq-surface p-3 text-sm">
          <input
            type="checkbox"
            checked={pollConfirmed}
            onChange={(event) => setPollConfirmed(event.target.checked)}
            className="mt-0.5"
          />
          <span>{tEvent("confirmPollOptions")}</span>
        </label>
      ) : null}

      {submitError ? (
        <p className="text-sm text-hq-danger" role="alert">
          {submitError}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void handleSave()}
        className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {submitting
          ? tCommon("loading")
          : t("saveScores", { count: activeRows.length })}
      </button>
    </div>
  );
}
