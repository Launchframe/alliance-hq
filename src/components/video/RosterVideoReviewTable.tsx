"use client";

import { Crosshair, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import type { AllianceMembersPayload } from "@/lib/members/load";
import {
  computeProjectedRosterRankCounts,
  ROSTER_MAX_MEMBERS,
  ROSTER_MAX_R4,
  validateRosterRankQuota,
  type RosterRankQuotaErrorCode,
} from "@/lib/members/roster-rank-quota.shared";
import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";
import { memberMatchConfidenceBorderClass } from "@/lib/video/member-match-confidence-class";
import {
  duplicateMemberRowIds,
  findDuplicateMemberAssignments,
} from "@/lib/video/review-validation";
import {
  findFuzzyMemberCandidates,
  type AshedMember,
} from "@/lib/video/member-matcher";
import {
  findUnmatchedRosterRowIds,
  isRosterRowNameMismatch,
} from "@/lib/video/roster-video-review.shared";

export type RosterVideoReviewRow = {
  id: string;
  ocrName: string;
  allianceRank: number | null;
  heroPowerM: number | null;
  memberLevel: number | null;
  profession: string | null;
  frameIndex?: number | null;
  memberId: string | null;
  memberName: string | null;
  matchConfidence: number | null;
  matchMethod?: string | null;
  deleted: number;
};

type Props = {
  rows: RosterVideoReviewRow[];
  members: AllianceMembersPayload["members"];
  filterQuery: string;
  duplicateRowIds: Set<string>;
  unmatchedRowIds: Set<string>;
  onUpdateRow: (id: string, patch: Partial<RosterVideoReviewRow>) => void;
  onDeleteRow: (id: string) => void;
  onPreviewFrame?: (frameIndex: number | null | undefined) => void;
  rowCanVideoPreview?: (frameIndex: number | null | undefined) => boolean;
  onQuotaChange?: (payload: {
    errors: RosterRankQuotaErrorCode[];
    counts: ReturnType<typeof computeProjectedRosterRankCounts>;
    canSubmitRanks: boolean;
  }) => void;
};

const RANK_OPTIONS = [1, 2, 3, 4, 5] as const;

function normalizeOcrName(name: string): string {
  return name.trim().toLowerCase();
}

function findDuplicateOcrNameRowIds(rows: RosterVideoReviewRow[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const row of rows) {
    if (row.deleted === 1) continue;
    const key = normalizeOcrName(row.ocrName);
    const list = byName.get(key) ?? [];
    list.push(row.id);
    byName.set(key, list);
  }
  const dupes = new Set<string>();
  for (const ids of byName.values()) {
    if (ids.length > 1) {
      for (const id of ids) dupes.add(id);
    }
  }
  return dupes;
}

export function RosterVideoReviewTable({
  rows,
  members,
  filterQuery,
  duplicateRowIds,
  unmatchedRowIds,
  onUpdateRow,
  onDeleteRow,
  onPreviewFrame,
  rowCanVideoPreview,
  onQuotaChange,
}: Props) {
  const t = useTranslations("videoReview");
  const tMembers = useTranslations("members.import");
  const tMembersList = useTranslations("members");

  const activeRows = useMemo(
    () => rows.filter((row) => row.deleted !== 1),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return activeRows;
    return activeRows.filter((row) => row.ocrName.toLowerCase().includes(q));
  }, [activeRows, filterQuery]);

  const duplicateOcrNameRowIds = useMemo(
    () => findDuplicateOcrNameRowIds(activeRows),
    [activeRows],
  );

  const existingForQuota = useMemo(
    () =>
      members.map((member) => ({
        ashedMemberId: member.id,
        allianceRank:
          member.alliance_rank ??
          member.allianceRank ??
          (typeof member.rank === "number" ? member.rank : null),
        status: member.status,
      })),
    [members],
  );

  const commitRowsForQuota = useMemo(
    () =>
      activeRows
        .filter(
          (row) =>
            row.allianceRank != null &&
            row.allianceRank >= 1 &&
            row.allianceRank <= 5,
        )
        .map((row) => ({
          matchMemberId: row.memberId,
          allianceRank: row.allianceRank!,
        })),
    [activeRows],
  );

  const projectedCounts = useMemo(
    () =>
      computeProjectedRosterRankCounts(existingForQuota, commitRowsForQuota),
    [commitRowsForQuota, existingForQuota],
  );

  const quotaErrors = useMemo(
    () => validateRosterRankQuota(projectedCounts),
    [projectedCounts],
  );

  const rowsMissingRank = activeRows.some(
    (row) =>
      row.allianceRank == null || row.allianceRank < 1 || row.allianceRank > 5,
  );

  const canSubmitRanks =
    !rowsMissingRank && quotaErrors.length === 0 && activeRows.length > 0;

  useEffect(() => {
    onQuotaChange?.({
      errors: quotaErrors,
      counts: projectedCounts,
      canSubmitRanks,
    });
  }, [canSubmitRanks, onQuotaChange, projectedCounts, quotaErrors]);

  const memberOptions = useMemo(
    () =>
      [...members]
        .filter((member) => member.status !== "former")
        .sort((a, b) => a.current_name.localeCompare(b.current_name)),
    [members],
  );

  const assignedMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of activeRows) {
      const id = row.memberId?.trim();
      if (id) ids.add(id);
    }
    return ids;
  }, [activeRows]);

  function quotaErrorLabel(code: RosterRankQuotaErrorCode): string {
    return t(`rosterQuota.${code}`, {
      maxR4: ROSTER_MAX_R4,
      maxMembers: ROSTER_MAX_MEMBERS,
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-hq-border bg-hq-surface p-4 text-sm">
        <p className="font-medium text-hq-fg">{t("rosterQuotaTitle")}</p>
        <p className="mt-2 text-hq-fg-muted">
          {t("rosterQuotaSummary", {
            r5: projectedCounts.r5,
            r4: projectedCounts.r4,
            r3: projectedCounts.r3,
            r2: projectedCounts.r2,
            r1: projectedCounts.r1,
            total: projectedCounts.total,
            maxR4: ROSTER_MAX_R4,
            maxMembers: ROSTER_MAX_MEMBERS,
          })}
        </p>
        {quotaErrors.length > 0 ? (
          <ul className="mt-2 list-inside list-disc text-hq-danger">
            {quotaErrors.map((code) => (
              <li key={code}>{quotaErrorLabel(code)}</li>
            ))}
          </ul>
        ) : canSubmitRanks ? (
          <p className="mt-2 text-hq-green">{t("rosterQuotaOk")}</p>
        ) : null}
        {rowsMissingRank ? (
          <p className="mt-2 text-[#d29922]">{t("rosterRankRequired")}</p>
        ) : null}
        {unmatchedRowIds.size > 0 ? (
          <p className="mt-2 text-[#d29922]">
            {t("rosterNameMismatchBlocked", { count: unmatchedRowIds.size })}
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-hq-border">
        <table className="w-full min-w-[36rem] table-fixed text-sm">
          <thead className="bg-hq-surface text-left text-hq-fg-muted">
            <tr>
              <th className="w-[22%] px-3 py-3 sm:px-4">{t("colName")}</th>
              <th className="w-[34%] px-3 py-3 sm:px-4">{t("colMember")}</th>
              <th className="w-[5.5rem] px-2 py-3 sm:w-24">{t("colAllianceRank")}</th>
              <th className="w-[5.5rem] px-2 py-3 sm:w-28">{t("colPower")}</th>
              <th className="w-[4.5rem] px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isDuplicateMember = duplicateRowIds.has(row.id);
              const isDuplicateName = duplicateOcrNameRowIds.has(row.id);
              const isNameMismatch = unmatchedRowIds.has(row.id);
              const canPreview = rowCanVideoPreview?.(row.frameIndex) ?? false;
              const fuzzyCandidates = isNameMismatch
                ? findFuzzyMemberCandidates(row.ocrName, members as AshedMember[], {
                    limit: 1,
                  })
                : [];
              const closestCandidate = fuzzyCandidates[0];
              const rowClass =
                isDuplicateMember || isDuplicateName || isNameMismatch
                  ? "border-t border-hq-border bg-[#f8514910]"
                  : "border-t border-hq-border";

              return (
                <tr key={row.id} className={rowClass}>
                  <td className="px-3 py-3 font-medium sm:px-4">
                    <div className="break-words">{row.ocrName}</div>
                    {isNameMismatch ? (
                      <p className="mt-1 text-xs text-[#d29922]">
                        {t("rosterNameMismatchRow")}
                      </p>
                    ) : null}
                    {isNameMismatch && row.memberName ? (
                      <p className="mt-1 text-xs text-hq-fg-muted">
                        {t("rosterNameMismatchRosterName", {
                          name: row.memberName,
                        })}
                      </p>
                    ) : null}
                    {isNameMismatch && closestCandidate && !row.memberId ? (
                      <p className="mt-1 text-xs text-hq-fg-muted">
                        {t("rosterNameMismatchClosest", {
                          name: closestCandidate.name,
                        })}
                      </p>
                    ) : null}
                    {isDuplicateMember ? (
                      <p className="mt-1 text-xs text-hq-danger">
                        {t("duplicateMemberRow")}
                      </p>
                    ) : null}
                    {isDuplicateName ? (
                      <p className="mt-1 text-xs text-hq-danger">
                        {t("duplicateOcrNameRow")}
                      </p>
                    ) : null}
                  </td>
                  <td className="min-w-0 px-3 py-3 sm:px-4">
                    <AppSelect
                      value={row.memberId ?? ""}
                      onChange={(next) => {
                        const member = memberOptions.find((m) => m.id === next);
                        onUpdateRow(row.id, {
                          memberId: next || null,
                          memberName: member?.current_name ?? null,
                          matchConfidence: next ? 1 : 0,
                          matchMethod: next ? "exact" : "none",
                        });
                      }}
                      aria-label={t("colMember")}
                      placeholder={tMembers("createNew")}
                      className="w-full min-w-0"
                      triggerClassName={`px-2 py-1.5 ${memberMatchConfidenceBorderClass(row.matchConfidence)}`}
                      searchable
                      searchMode="fuzzy"
                      combobox
                      hideEmptyOptionWhileSearching
                      searchPlaceholder={tMembersList("searchPlaceholder")}
                      noSearchResultsLabel={t("memberSearchNoResults")}
                      options={buildMemberMatchSelectOptions(memberOptions, {
                        emptyLabel: tMembers("createNew"),
                        highlightMemberId: row.memberId,
                        highlightConfidence: row.matchConfidence,
                        excludeMemberIds: assignedMemberIds,
                      })}
                    />
                  </td>
                  <td className="px-2 py-3">
                    <AppSelect
                      value={
                        row.allianceRank != null ? String(row.allianceRank) : ""
                      }
                      onChange={(next) =>
                        onUpdateRow(row.id, {
                          allianceRank: next ? Number(next) : null,
                        })
                      }
                      aria-label={t("colAllianceRank")}
                      className="w-full max-w-[5.5rem]"
                      triggerClassName={`px-2 py-1.5 ${
                        row.allianceRank == null ||
                        row.allianceRank < 1 ||
                        row.allianceRank > 5
                          ? "border-hq-danger"
                          : "border-[#484f58]"
                      }`}
                      options={[
                        { value: "", label: t("rosterRankPlaceholder") },
                        ...RANK_OPTIONS.map((rank) => ({
                          value: String(rank),
                          label: `R${rank}`,
                        })),
                      ]}
                    />
                  </td>
                  <td className="px-2 py-3">
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      className="w-full max-w-[6.5rem] rounded border border-hq-border bg-hq-canvas px-2 py-1.5"
                      value={row.heroPowerM ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        onUpdateRow(row.id, {
                          heroPowerM: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                      aria-label={t("colPower")}
                    />
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canPreview && onPreviewFrame ? (
                        <button
                          type="button"
                          onClick={() => onPreviewFrame(row.frameIndex)}
                          className="inline-flex size-8 items-center justify-center rounded-lg text-hq-accent hover:bg-hq-surface-muted"
                          aria-label={t("rowVideoPreview")}
                          title={t("rowVideoPreview")}
                        >
                          <Crosshair className="size-4" aria-hidden />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onDeleteRow(row.id)}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-hq-danger hover:bg-[#f8514915]"
                        aria-label={t("deleteRow")}
                        title={t("deleteRow")}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function useRosterReviewValidation(rows: RosterVideoReviewRow[]) {
  const activeRows = rows.filter((row) => row.deleted !== 1);

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

  const duplicateOcrNameRowIds = useMemo(
    () => findDuplicateOcrNameRowIds(activeRows),
    [activeRows],
  );

  const unmatchedRowIds = useMemo(
    () => findUnmatchedRosterRowIds(activeRows),
    [activeRows],
  );

  return {
    activeRows,
    duplicateMemberIssues,
    duplicateRowIds,
    unmatchedRowIds,
    hasDuplicateMembers: duplicateMemberIssues.length > 0,
    hasDuplicateOcrNames: duplicateOcrNameRowIds.size > 0,
    hasUnresolvedNameMismatches: unmatchedRowIds.size > 0,
    isRosterRowNameMismatch,
  };
}
