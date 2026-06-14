"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Link } from "@/i18n/navigation";
import { useVideoJob } from "@/components/video/VideoJobEventsProvider";
import {
  duplicateMemberRowIds,
  findDuplicateMemberAssignments,
} from "@/lib/video/review-validation";

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
  const liveJob = useVideoJob(jobId);

  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [events, setEvents] = useState<Array<{ id: string; name?: string }>>(
    [],
  );
  const [jobStatus, setJobStatus] = useState<string>("loading");
  const [allianceId, setAllianceId] = useState<string | null>(null);
  const [eventId, setEventId] = useState("");
  const [team, setTeam] = useState<"A" | "B">("A");
  const [recordedDate, setRecordedDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

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

  const load = useCallback(
    async (options?: { skipRematch?: boolean }) => {
      const res = await fetch(`/api/tools/video-upload/${jobId}`);
      const data = (await res.json()) as {
        error?: string;
        job?: { status: string; allianceId?: string | null };
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
          await load({ skipRematch: true });
          return;
        }
      }

      setJobStatus(data.job?.status ?? "unknown");
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
    void load();
  }, [load]);

  useEffect(() => {
    if (!liveJob) {
      return;
    }

    if (liveJob.status === "queued" || liveJob.status === "extracting" || liveJob.status === "parsing") {
      setJobStatus(liveJob.status);
      return;
    }

    if (liveJob.status === "review" || liveJob.status === "failed") {
      void load();
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

  useEffect(() => {
    async function fetchEvents() {
      if (!allianceId) return;
      const q = encodeURIComponent(JSON.stringify({ alliance_id: allianceId }));
      const res = await fetch(
        `/api/bff/v1/entities/DesertStormEvent?q=${q}`,
      );
      if (res.ok) {
        const data = (await res.json()) as Array<{ id: string; name?: string }>;
        setEvents(data);
        if (data[0] && !eventId) {
          setEventId(data[0].id);
        }
      }
    }
    void fetchEvents();
  }, [allianceId, eventId]);

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
  const canSubmit =
    activeRows.length > 0 &&
    eventId &&
    !hasDuplicateMembers &&
    !submitting;

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
          eventId,
          team,
          recordedDate,
          rows: activeRows.map((r) => ({
            id: r.id,
            memberId: r.memberId,
            memberName: r.memberName ?? r.ocrName,
            score: r.score,
            deleted: false,
          })),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        submitted?: number;
        duplicateMembers?: Array<{ memberName: string }>;
      };
      if (!res.ok) {
        setError(data.error ?? tc("uploadFailed"));
        return;
      }
      setSuccess(t("submitSuccess", { count: data.submitted ?? 0 }));
      setJobStatus("complete");
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

  if (jobStatus === "loading" || rematching) {
    return (
      <p className="text-sm text-[#8b949e]">
        {rematching ? t("rematchingMembers") : t("loading")}
      </p>
    );
  }

  if (
    reprocessing ||
    jobStatus === "queued" ||
    jobStatus === "extracting" ||
    jobStatus === "parsing"
  ) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#8b949e]">
          {reprocessing
            ? t("reprocessing")
            : t("processing", { status: jobStatus })}
        </p>
        <Link href="/tools/video-upload" className="text-sm text-[#58a6ff] hover:underline">
          {t("backToUploads")}
        </Link>
      </div>
    );
  }

  if (jobStatus === "failed") {
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
        <Link
          href="/tools/video-upload"
          className="text-sm text-[#58a6ff] hover:underline"
        >
          {t("backToUploads")}
        </Link>
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
        <label className="block text-sm">
          <span className="mb-1 block text-[#8b949e]">{t("eventLabel")}</span>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name ?? ev.id}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[#8b949e]">{t("teamLabel")}</span>
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value as "A" | "B")}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            <option value="A">Team A</option>
            <option value="B">Team B</option>
          </select>
        </label>
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
                  <select
                    value={row.memberId ?? ""}
                    onChange={(e) => {
                      const member = members.find((m) => m.id === e.target.value);
                      updateRow(row.id, {
                        memberId: e.target.value || null,
                        memberName: member?.current_name ?? null,
                        matchConfidence: e.target.value ? 1 : 0,
                      });
                    }}
                    className={`w-full min-w-[12rem] rounded-lg border bg-[#0d1117] px-2 py-1.5 ${confidenceClass(row.matchConfidence)}`}
                  >
                    <option value="">{t("unmatched")}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.current_name}
                        {row.memberId === m.id &&
                        row.matchConfidence != null &&
                        row.matchConfidence < 1
                          ? ` (${Math.round(row.matchConfidence * 100)}%)`
                          : ""}
                      </option>
                    ))}
                  </select>
                </td>
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
