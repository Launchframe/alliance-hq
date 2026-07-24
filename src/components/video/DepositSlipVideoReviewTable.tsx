"use client";

import { ChevronDown, ChevronRight, Video, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import {
  DEPOSIT_SLIP_CLEARED_MEMBER_MATCH,
  depositSlipMemberMatchBorderClass,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-member-match.shared";
import {
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type DepositStatus,
  type DepositTermDays,
} from "@/lib/banks/types.shared";
import { formatDepositSlipGameTimestamp } from "@/lib/banks/deposit-slip-ocr/deposit-slip-game-timestamp.shared";
import {
  flaggedClusterIdsWithSingleSurvivor,
  groupUnresolvedFlaggedClusters,
  otherLiveClusterRowIds,
} from "@/lib/banks/deposit-slip-flagged-clusters.shared";
import {
  depositSlipReviewRowSummaryParts,
  diffKeysForDepositSlipRows,
  type DepositSlipReviewRowSummaryFields,
} from "@/lib/banks/deposit-slip-review-row-summary.shared";
import { validateDepositSlipReviewRows } from "@/lib/banks/deposit-slip-review-validation.shared";
import {
  filterAndSortDepositSlipReviewRows,
  type DepositSlipVisibleSortKey,
} from "@/lib/banks/deposit-slip-review-visible-rows.shared";
import {
  isDedupeReport,
  type DedupeCluster,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";
import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";

/** Follow-me scrubbing only works when rows are ordered by deposit time. */
export function depositSlipFollowMeCompatible(
  sortKey: DepositSlipVisibleSortKey,
): boolean {
  return sortKey === "depositAt";
}

export type DepositSlipVideoReviewRow = {
  id: string;
  ocrName: string;
  score: string | null;
  powerLevel: string | null;
  memberLevel: number | null;
  profession: string | null;
  allianceRankTitle: string | null;
  rosterRankRaw: string | null;
  memberId?: string | null;
  memberName?: string | null;
  matchConfidence?: number | null;
  matchMethod?: string | null;
  frameIndex?: number | null;
  dedupeClusterId?: string | null;
  dedupeFlag?: boolean;
  deleted: number;
};

export type DepositSlipMemberOption = {
  id: string;
  current_name: string;
  previous_names?: string[];
};

type Props = {
  /** Bank roster alliance tag — applied when officer manually assigns a member. */
  rosterAllianceTag?: string | null;
  rows: DepositSlipVideoReviewRow[];
  /** Job roster — officers pick when OCR does not auto-link. */
  members: DepositSlipMemberOption[];
  filterQuery: string;
  dedupeReport?: DedupeReport | null;
  onUpdateRow: (id: string, patch: Partial<DepositSlipVideoReviewRow>) => void;
  onDeleteRow: (id: string) => void;
  onPreviewFrame?: (frameIndex: number | null | undefined) => void;
  rowCanVideoPreview?: (frameIndex: number | null | undefined) => boolean;
  /** Stable Follow-me callback ref factory keyed by row id. */
  registerFollowAnchor?: (rowId: string) => (element: HTMLElement | null) => void;
  /** Visible (filtered + sorted) row ids for Follow-me interpolation. */
  onVisibleRowIdsChange?: (ids: readonly string[]) => void;
  /** Notifies parent when sort changes so Follow-me can be gated. */
  onSortKeyChange?: (sortKey: DepositSlipVisibleSortKey) => void;
  /** Follow-me row highlight (deposit-slip review). */
  highlightedRowId?: string | null;
  /** Scroll the table to a row (flagged-cluster / warning banners). */
  onJumpToRow?: (rowId: string) => void;
};

const FLAG_REASON_KEYS = [
  "same_commander_timestamp_conflicting_amount_or_term",
  "borderline_commander_name_same_minute",
  "timestamp_collision_different_commanders",
  "same_commander_timestamp_conflicting_identity",
  "commander_match_missing_timestamp_ambiguous",
] as const;

/** Snapshot keys ever worth diffing/highlighting in the flagged-cluster panel. */
const DIFFABLE_SNAPSHOT_KEYS = [
  "allianceTag",
  "amount",
  "termDays",
  "depositAt",
  "status",
] as const;

/** Field keys whose values disagree across a cluster's members (for bolding in the panel). */
export function clusterDiffKeys(cluster: DedupeCluster): Set<string> {
  const diffKeys = new Set<string>();
  for (const key of DIFFABLE_SNAPSHOT_KEYS) {
    const present = cluster.members
      .map((m) => m.snapshot[key])
      .filter((v) => v != null);
    const distinct = new Set(present.map((v) => JSON.stringify(v)));
    if (distinct.size > 1) diffKeys.add(key);
  }
  return diffKeys;
}

/** Every other member's slipId in the cluster — used by "keep this one, delete the rest". */
export function otherClusterMemberSlipIds(
  cluster: DedupeCluster,
  keepSlipId: string,
): string[] {
  return cluster.members
    .map((m) => m.slipId)
    .filter((slipId) => slipId !== keepSlipId);
}

type FlagReasonKey = (typeof FLAG_REASON_KEYS)[number];

function isFlagReasonKey(reason: string): reason is FlagReasonKey {
  return (FLAG_REASON_KEYS as readonly string[]).includes(reason);
}

function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function datetimeLocalToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Treat datetime-local as UTC wall clock (matches deposit-slip OCR timestamps).
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:00.000Z`;
}

function formatSnapshotTime(value: unknown): string {
  return typeof value === "string"
    ? formatDepositSlipGameTimestamp(value)
    : "—";
}

function formatSnapshotLine(snapshot: Record<string, unknown>): string {
  const name =
    typeof snapshot.commanderName === "string" ? snapshot.commanderName : "—";
  const amount =
    typeof snapshot.amount === "number" ? String(snapshot.amount) : "—";
  const term =
    typeof snapshot.termDays === "number" ? String(snapshot.termDays) : "—";
  const status =
    typeof snapshot.status === "string" ? snapshot.status : "—";
  const depositAt = formatSnapshotTime(snapshot.depositAt);
  return `${name} · ${amount} · ${term}d · ${depositAt} · ${status}`;
}

function absorbedMemberCount(cluster: DedupeCluster): number {
  return cluster.members.filter((m) => m.slipId !== cluster.destinationSlipId)
    .length;
}

const LIFECYCLE_AUTO_MERGE_REASONS = new Set([
  "lifecycle_locked_to_matured",
  "lifecycle_locked_to_looted",
]);

function LiveRowSummaryFields({
  row,
  diffKeys,
}: {
  row: DepositSlipReviewRowSummaryFields;
  diffKeys: Set<string>;
}) {
  const parts = depositSlipReviewRowSummaryParts(row, diffKeys);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((part, index) => (
        <span key={part.key} className="inline-flex items-center gap-1">
          {index > 0 ? <span aria-hidden>·</span> : null}
          <span className={part.differs ? "font-semibold text-hq-danger" : undefined}>
            {part.text}
          </span>
        </span>
      ))}
    </span>
  );
}

export function DepositSlipVideoReviewTable({
  rows,
  members,
  rosterAllianceTag,
  filterQuery,
  dedupeReport = null,
  onUpdateRow,
  onDeleteRow,
  onPreviewFrame,
  rowCanVideoPreview,
  registerFollowAnchor,
  onVisibleRowIdsChange,
  onSortKeyChange,
  highlightedRowId,
  onJumpToRow,
}: Props) {
  const t = useTranslations("videoReview");
  const tBanks = useTranslations("bankManagement");
  const tMembers = useTranslations("members");
  const [sortKey, setSortKey] =
    useState<DepositSlipVisibleSortKey>("depositAt");
  const [autoDedupeOpen, setAutoDedupeOpen] = useState(false);
  const [missingTsOpen, setMissingTsOpen] = useState(false);
  const [sortFrozenRowIds, setSortFrozenRowIds] = useState<string[] | null>(
    null,
  );
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const report = isDedupeReport(dedupeReport) ? dedupeReport : null;
  const followMeCompatible = depositSlipFollowMeCompatible(sortKey);

  useLayoutEffect(() => {
    onSortKeyChange?.(sortKey);
  }, [sortKey, onSortKeyChange]);

  const activeRows = useMemo(
    () => rows.filter((row) => row.deleted !== 1),
    [rows],
  );

  const validation = useMemo(
    () => validateDepositSlipReviewRows(activeRows, report),
    [activeRows, report],
  );
  const incompleteRowIds = validation.incompleteRowIds;
  const unresolvedClusterIds = validation.unresolvedClusterIds;

  const flaggedReasonByClusterId = useMemo(() => {
    const map = new Map<string, string>();
    for (const cluster of report?.clusters ?? []) {
      if (cluster.disposition === "flagged") {
        map.set(cluster.clusterId, cluster.reason);
      }
    }
    return map;
  }, [report]);

  const autoMergedClusters = useMemo(
    () =>
      (report?.clusters ?? []).filter(
        (c): c is DedupeCluster =>
          c.disposition === "auto_merged" &&
          c.reason !== "redundant_missing_timestamp",
      ),
    [report],
  );

  const missingTsClusters = useMemo(
    () =>
      (report?.clusters ?? []).filter(
        (c): c is DedupeCluster =>
          c.disposition === "auto_merged" &&
          c.reason === "redundant_missing_timestamp",
      ),
    [report],
  );

  const autoMergedAbsorbedCount = useMemo(
    () =>
      autoMergedClusters.reduce((n, c) => n + absorbedMemberCount(c), 0),
    [autoMergedClusters],
  );

  const missingTsAbsorbedCount = useMemo(
    () =>
      missingTsClusters.reduce((n, c) => n + absorbedMemberCount(c), 0),
    [missingTsClusters],
  );

  const flaggedClusterIds = useMemo(
    () =>
      new Set(
        (report?.clusters ?? [])
          .filter((cluster) => cluster.disposition === "flagged")
          .map((cluster) => cluster.clusterId),
      ),
    [report],
  );

  const liveFlaggedClusterGroups = useMemo(
    () =>
      groupUnresolvedFlaggedClusters(
        activeRows,
        unresolvedClusterIds,
        flaggedReasonByClusterId,
        report?.clusters ?? [],
      ),
    [
      activeRows,
      unresolvedClusterIds,
      flaggedReasonByClusterId,
      report?.clusters,
    ],
  );

  useLayoutEffect(() => {
    const survivors = flaggedClusterIdsWithSingleSurvivor(
      activeRows,
      flaggedClusterIds,
    );
    for (const { survivorId } of survivors) {
      const row = activeRows.find((r) => r.id === survivorId);
      if (row?.dedupeClusterId) {
        onUpdateRow(survivorId, { dedupeClusterId: null });
      }
    }
  }, [activeRows, flaggedClusterIds, onUpdateRow]);

  function lifecycleDestinationLabel(
    cluster: DedupeCluster,
    destination: DedupeCluster["members"][number],
  ): string | null {
    if (!LIFECYCLE_AUTO_MERGE_REASONS.has(cluster.reason)) return null;
    const depositAt = formatSnapshotTime(destination.snapshot.depositAt);
    const outcomeAt = formatSnapshotTime(
      destination.snapshot.outcomeAt ?? destination.snapshot.depositAt,
    );
    if (cluster.reason === "lifecycle_locked_to_looted") {
      return t("depositSlipLifecycleLooted", { depositAt, outcomeAt });
    }
    return t("depositSlipLifecycleMatured", { depositAt, outcomeAt });
  }

  const filteredRows = useMemo(
    () =>
      filterAndSortDepositSlipReviewRows(activeRows, {
        filterQuery,
        sortKey,
      }),
    [activeRows, filterQuery, sortKey],
  );

  const displayRows = useMemo(() => {
    if (!sortFrozenRowIds) return filteredRows;
    const byId = new Map(filteredRows.map((row) => [row.id, row]));
    return sortFrozenRowIds
      .map((id) => byId.get(id))
      .filter((row): row is DepositSlipVideoReviewRow => row != null);
  }, [filteredRows, sortFrozenRowIds]);

  useLayoutEffect(() => {
    onVisibleRowIdsChange?.(displayRows.map((row) => row.id));
  }, [displayRows, onVisibleRowIdsChange]);

  function flagReasonLabel(reason: string): string {
    if (isFlagReasonKey(reason)) {
      return t(`depositSlipFlagReason.${reason}`);
    }
    return t("depositSlipFlaggedRow");
  }

  function handleKeepFlaggedClusterRow(
    clusterGroup: (typeof liveFlaggedClusterGroups)[number],
    keepRowId: string,
  ) {
    for (const rowId of otherLiveClusterRowIds(clusterGroup.liveRows, keepRowId)) {
      onDeleteRow(rowId);
    }
    onUpdateRow(keepRowId, { dedupeClusterId: null });
  }

  return (
    <div className="space-y-3">
      {liveFlaggedClusterGroups.length > 0 ? (
        <div className="rounded-xl border border-hq-danger/40 bg-[#f8514915] p-4 text-sm text-hq-danger">
          <p className="font-medium">
            {t("depositSlipFlaggedTitle", {
              count: liveFlaggedClusterGroups.length,
            })}
          </p>
          <p className="mt-2 text-hq-fg">{t("depositSlipFlaggedHint")}</p>
          <ul className="mt-3 space-y-3">
            {liveFlaggedClusterGroups.map((clusterGroup) => {
              const diffKeys = diffKeysForDepositSlipRows(clusterGroup.liveRows);
              const reason = clusterGroup.reason ?? "";
              return (
                <li
                  key={clusterGroup.clusterId}
                  className="rounded-lg border border-hq-danger/30 bg-hq-canvas p-3 text-hq-fg"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-hq-danger">
                    {reason ? flagReasonLabel(reason) : t("depositSlipFlaggedRow")}
                  </p>
                  {clusterGroup.staleReport ? (
                    <p className="mt-2 text-xs text-hq-fg-muted">
                      {t("depositSlipStaleClusterNote")}
                    </p>
                  ) : null}
                  <ul className="mt-2 space-y-1.5">
                    {clusterGroup.liveRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-hq-surface-muted/40 px-2 py-1.5"
                      >
                        <LiveRowSummaryFields row={row} diffKeys={diffKeys} />
                        <div className="flex flex-wrap items-center gap-2">
                          {onJumpToRow ? (
                            <button
                              type="button"
                              onClick={() => onJumpToRow(row.id)}
                              className="whitespace-nowrap rounded-md border border-hq-border px-2 py-1 text-xs text-hq-fg hover:bg-hq-surface-muted"
                            >
                              {t("depositSlipWarningRowJump")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              handleKeepFlaggedClusterRow(clusterGroup, row.id)
                            }
                            className="whitespace-nowrap rounded-md border border-hq-border px-2 py-1 text-xs text-hq-fg hover:bg-hq-surface-muted"
                          >
                            {t("depositSlipFlaggedKeepThisOne")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {incompleteRowIds.size > 0 ? (
        <div className="rounded-xl border border-[#d29922]/40 bg-[#d2992215] p-4 text-sm text-[#d29922]">
          <p>{t("depositSlipIncompleteBlocked")}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-hq-fg-muted" htmlFor="deposit-slip-sort">
          {t("depositSlipSortBy")}
        </label>
        <AppSelect
          id="deposit-slip-sort"
          value={sortKey}
          onChange={(next) =>
            setSortKey(next === "commander" ? "commander" : "depositAt")
          }
          aria-label={t("depositSlipSortBy")}
          options={[
            {
              value: "depositAt",
              label: t("depositSlipSortDepositAt"),
            },
            {
              value: "commander",
              label: t("depositSlipSortCommander"),
            },
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-hq-border">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
          <thead className="bg-hq-surface-muted text-xs uppercase tracking-wide text-hq-fg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">
                {tBanks("fields.commanderName")}
              </th>
              <th className="px-3 py-2 font-medium">
                {tBanks("fields.allianceTag")}
              </th>
              <th className="px-3 py-2 font-medium">{t("colMember")}</th>
              <th className="px-3 py-2 font-medium">{tBanks("fields.amount")}</th>
              <th className="px-3 py-2 font-medium">
                {tBanks("fields.termDays")}
              </th>
              <th className="px-3 py-2 font-medium">
                {tBanks("fields.depositAt")}
              </th>
              <th className="px-3 py-2 font-medium">{tBanks("fields.status")}</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody
            ref={tbodyRef}
            onFocusCapture={() => {
              setSortFrozenRowIds(filteredRows.map((row) => row.id));
            }}
            onBlurCapture={(event) => {
              const tbody = tbodyRef.current;
              const next = event.relatedTarget;
              if (
                tbody &&
                next instanceof Node &&
                tbody.contains(next)
              ) {
                return;
              }
              setSortFrozenRowIds(null);
            }}
          >
            {displayRows.map((row) => {
              const canPreview =
                rowCanVideoPreview?.(row.frameIndex) && onPreviewFrame;
              const isIncomplete = incompleteRowIds.has(row.id);
              const isFlagged =
                Boolean(row.dedupeClusterId) &&
                unresolvedClusterIds.has(row.dedupeClusterId!);
              const flagReason = row.dedupeClusterId
                ? flaggedReasonByClusterId.get(row.dedupeClusterId)
                : undefined;
              const rowClass = isFlagged
                ? "border-t border-hq-border bg-[#f8514910]"
                : isIncomplete
                  ? "border-t border-hq-border bg-[#d2992210]"
                  : highlightedRowId === row.id
                    ? "border-t border-hq-border bg-[#58a6ff18] ring-1 ring-inset ring-hq-accent/50"
                    : "border-t border-hq-border";

              return (
                <tr
                  key={row.id}
                  className={rowClass}
                  data-deposit-slip-row-id={row.id}
                  ref={
                    followMeCompatible
                      ? registerFollowAnchor?.(row.id)
                      : undefined
                  }
                  data-video-follow-anchor={
                    followMeCompatible ? row.id : undefined
                  }
                >
                  <td className="px-3 py-2 align-top">
                    <input
                      type="text"
                      value={row.ocrName}
                      onChange={(e) =>
                        onUpdateRow(row.id, { ocrName: e.target.value })
                      }
                      className="w-full min-w-[8rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5"
                    />
                    {isFlagged ? (
                      <p className="mt-1 text-xs text-hq-danger">
                        {flagReason
                          ? flagReasonLabel(flagReason)
                          : t("depositSlipFlaggedRow")}
                      </p>
                    ) : null}
                    {isIncomplete ? (
                      <p className="mt-1 text-xs text-[#d29922]">
                        {t("depositSlipIncompleteRow")}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="text"
                      value={row.allianceRankTitle ?? ""}
                      onChange={(e) =>
                        onUpdateRow(row.id, {
                          allianceRankTitle: e.target.value || null,
                        })
                      }
                      className="w-full min-w-[4rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5"
                    />
                  </td>
                  <td className="min-w-[8rem] px-3 py-2 align-top sm:min-w-[11rem]">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <AppSelect
                          value={row.memberId ?? ""}
                          onChange={(next) => {
                            if (!next) {
                              onUpdateRow(row.id, DEPOSIT_SLIP_CLEARED_MEMBER_MATCH);
                              return;
                            }
                            // Roster may omit a previously selected member
                            // (cross-device); keep the stored label via rows.
                            const fromRoster = members.find((m) => m.id === next);
                            const fromSelected = rows.find(
                              (r) => r.memberId === next && r.memberName,
                            );
                            onUpdateRow(row.id, {
                              memberId: next,
                              memberName:
                                fromRoster?.current_name ??
                                fromSelected?.memberName ??
                                (row.memberId === next ? row.memberName : null) ??
                                null,
                              matchConfidence: 1,
                              // Commit honors preferredAshedMemberId only when
                              // matchMethod is a real auto-link method (not "none").
                              matchMethod: "exact",
                              ...(rosterAllianceTag?.trim()
                                ? { allianceRankTitle: rosterAllianceTag.trim() }
                                : {}),
                            });
                          }}
                          aria-label={t("colMember")}
                          placeholder={t("unmatched")}
                          triggerClassName={`px-2 py-1.5 ${
                            row.memberId
                              ? depositSlipMemberMatchBorderClass(
                                  row.matchConfidence,
                                )
                              : "border-hq-border"
                          }`}
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
                            // Same commander may appear on multiple deposit rows.
                          })}
                        />
                      </div>
                      {row.memberId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-hq-muted hover:text-hq-fg"
                          aria-label={t("clearMemberMatch")}
                          title={t("clearMemberMatch")}
                          onClick={() =>
                            onUpdateRow(row.id, DEPOSIT_SLIP_CLEARED_MEMBER_MATCH)
                          }
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.score ?? ""}
                      onChange={(e) =>
                        onUpdateRow(row.id, { score: e.target.value || null })
                      }
                      className="w-full min-w-[5rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5 font-mono"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <AppSelect
                      value={
                        row.memberLevel != null ? String(row.memberLevel) : ""
                      }
                      onChange={(next) => {
                        const n = Number(next);
                        onUpdateRow(row.id, {
                          memberLevel:
                            next &&
                            (DEPOSIT_TERMS as readonly number[]).includes(n)
                              ? (n as DepositTermDays)
                              : null,
                        });
                      }}
                      aria-label={tBanks("fields.termDays")}
                      searchable
                      combobox
                      searchPlaceholder={tBanks("fields.termDays")}
                      options={DEPOSIT_TERMS.map((term) => ({
                        value: String(term),
                        label: String(term),
                      }))}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="datetime-local"
                      value={isoToDatetimeLocalValue(row.powerLevel)}
                      onChange={(e) =>
                        onUpdateRow(row.id, {
                          powerLevel: datetimeLocalToIso(e.target.value),
                        })
                      }
                      className="w-full min-w-[11rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <AppSelect
                      value={row.profession ?? "locked"}
                      onChange={(next) =>
                        onUpdateRow(row.id, {
                          profession: (
                            DEPOSIT_STATUSES as readonly string[]
                          ).includes(next)
                            ? (next as DepositStatus)
                            : "locked",
                        })
                      }
                      aria-label={tBanks("fields.status")}
                      options={DEPOSIT_STATUSES.map((status) => ({
                        value: status,
                        label: tBanks(`status.${status}`),
                      }))}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-2">
                      {canPreview ? (
                        <button
                          type="button"
                          onClick={() => onPreviewFrame?.(row.frameIndex)}
                          className="rounded-md border border-hq-border p-1.5 text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
                          aria-label={t("rowVideoPreview")}
                        >
                          <Video className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onDeleteRow(row.id)}
                        className="rounded-md border border-hq-border px-2 py-1 text-xs text-hq-danger hover:bg-[#f8514910]"
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

      {autoMergedAbsorbedCount > 0 ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface-muted/40 p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-hq-fg">
                {t("depositSlipAutoDedupeTitle", {
                  count: autoMergedAbsorbedCount,
                })}
              </p>
              <p className="mt-1 text-hq-fg-muted">
                {t("depositSlipAutoDedupeHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAutoDedupeOpen((open) => !open)}
              className="inline-flex items-center gap-1 rounded-md border border-hq-border px-2 py-1 text-xs hover:bg-hq-canvas"
            >
              {autoDedupeOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {autoDedupeOpen
                ? t("depositSlipAutoDedupeToggleHide")
                : t("depositSlipAutoDedupeToggleShow")}
            </button>
          </div>
          {autoDedupeOpen ? (
            <ul className="mt-3 space-y-3">
              {autoMergedClusters.map((cluster) => {
                const destination = cluster.members.find(
                  (m) => m.slipId === cluster.destinationSlipId,
                );
                const sources = cluster.members.filter(
                  (m) => m.slipId !== cluster.destinationSlipId,
                );
                const lifecycleLabel = destination
                  ? lifecycleDestinationLabel(cluster, destination)
                  : null;
                return (
                  <li
                    key={cluster.clusterId}
                    className="rounded-lg border border-hq-border bg-hq-canvas p-3"
                  >
                    {destination ? (
                      <p className="text-hq-fg">
                        <span className="mr-2 rounded bg-hq-success/15 px-1.5 py-0.5 text-xs font-medium text-hq-success">
                          {t("depositSlipAutoDedupeDestination")}
                        </span>
                        {lifecycleLabel ??
                          formatSnapshotLine(destination.snapshot)}
                      </p>
                    ) : null}
                    {cluster.correctedFields &&
                    cluster.correctedFields.length > 0 ? (
                      <p className="mt-1 text-xs text-hq-fg-muted">
                        {t("depositSlipAutoDedupeMajorityCorrected", {
                          fields: cluster.correctedFields.join(", "),
                        })}
                      </p>
                    ) : null}
                    <ul className="mt-2 space-y-1 text-hq-fg-muted">
                      {sources.map((source) => (
                        <li key={source.slipId}>
                          <span className="mr-2 rounded bg-hq-surface-muted px-1.5 py-0.5 text-xs">
                            {t("depositSlipAutoDedupeSource")}
                          </span>
                          {formatSnapshotLine(source.snapshot)}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {missingTsAbsorbedCount > 0 ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface-muted/40 p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-hq-fg">
                {t("depositSlipMissingTsCoveredTitle", {
                  count: missingTsAbsorbedCount,
                })}
              </p>
              <p className="mt-1 text-hq-fg-muted">
                {t("depositSlipMissingTsCoveredHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMissingTsOpen((open) => !open)}
              className="inline-flex items-center gap-1 rounded-md border border-hq-border px-2 py-1 text-xs hover:bg-hq-canvas"
            >
              {missingTsOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {missingTsOpen
                ? t("depositSlipMissingTsCoveredToggleHide")
                : t("depositSlipMissingTsCoveredToggleShow")}
            </button>
          </div>
          {missingTsOpen ? (
            <ul className="mt-3 space-y-3">
              {missingTsClusters.map((cluster) => {
                const destination = cluster.members.find(
                  (m) => m.slipId === cluster.destinationSlipId,
                );
                const sources = cluster.members.filter(
                  (m) => m.slipId !== cluster.destinationSlipId,
                );
                return (
                  <li
                    key={cluster.clusterId}
                    className="rounded-lg border border-hq-border bg-hq-canvas p-3"
                  >
                    {destination ? (
                      <p className="text-hq-fg">
                        <span className="mr-2 rounded bg-hq-success/15 px-1.5 py-0.5 text-xs font-medium text-hq-success">
                          {t("depositSlipMissingTsCoveredKept")}
                        </span>
                        {formatSnapshotLine(destination.snapshot)}
                      </p>
                    ) : null}
                    <ul className="mt-2 space-y-1 text-hq-fg-muted">
                      {sources.map((source) => (
                        <li key={source.slipId}>
                          <span className="mr-2 rounded bg-hq-surface-muted px-1.5 py-0.5 text-xs">
                            {t("depositSlipMissingTsCoveredAbsorbed")}
                          </span>
                          {formatSnapshotLine(source.snapshot)}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function useDepositSlipReviewValidation(
  rows: DepositSlipVideoReviewRow[],
  dedupeReport?: DedupeReport | null,
) {
  const report = isDedupeReport(dedupeReport) ? dedupeReport : null;
  return validateDepositSlipReviewRows(rows, report);
}
