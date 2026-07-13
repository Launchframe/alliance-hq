"use client";

import { ChevronDown, ChevronRight, Video } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import {
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type DepositStatus,
  type DepositTermDays,
} from "@/lib/banks/types.shared";
import {
  validateDepositSlipReviewRows,
  type DepositSlipRequiredFieldKey,
} from "@/lib/banks/deposit-slip-review-validation.shared";
import { pairDepositSlipTerminalRows } from "@/lib/banks/deposit-slip-row-pairing.shared";
import {
  isDedupeReport,
  type DedupeCluster,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";

export type DepositSlipVideoReviewRow = {
  id: string;
  ocrName: string;
  score: string | null;
  powerLevel: string | null;
  memberLevel: number | null;
  profession: string | null;
  allianceRankTitle: string | null;
  rosterRankRaw: string | null;
  frameIndex?: number | null;
  dedupeClusterId?: string | null;
  dedupeFlag?: boolean;
  deleted: number;
};

type SortKey = "commander" | "depositAt";

type Props = {
  rows: DepositSlipVideoReviewRow[];
  filterQuery: string;
  dedupeReport?: DedupeReport | null;
  onUpdateRow: (id: string, patch: Partial<DepositSlipVideoReviewRow>) => void;
  onDeleteRow: (id: string) => void;
  onPreviewFrame?: (frameIndex: number | null | undefined) => void;
  rowCanVideoPreview?: (frameIndex: number | null | undefined) => boolean;
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

function normalizedRowStatus(profession: string | null): DepositStatus {
  return profession === "matured" || profession === "looted"
    ? profession
    : "locked";
}

/** Row background, matching the deposit's in-game state: blue=locked, orange=looted, green=matured. */
const STATUS_ROW_BG_CLASS: Record<DepositStatus, string> = {
  locked: "bg-hq-accent/10",
  looted: "bg-hq-orange/15",
  matured: "bg-hq-green/15",
};

/** Thick group-wrapper border for a locked+terminal pair, colored by the terminal outcome. */
const TERMINAL_GROUP_BORDER_CLASS: Record<"looted" | "matured", string> = {
  looted: "border-hq-orange",
  matured: "border-hq-green",
};

/** Shared column layout so the header and every row (grouped or standalone) line up. */
const ROW_GRID_TEMPLATE =
  "minmax(11rem,1.6fr) minmax(4.5rem,0.8fr) minmax(5.5rem,0.8fr) 5.5rem minmax(12rem,1.2fr) 8.5rem 7rem";

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

function formatSnapshotLine(snapshot: Record<string, unknown>): string {
  const name =
    typeof snapshot.commanderName === "string" ? snapshot.commanderName : "—";
  const amount =
    typeof snapshot.amount === "number" ? String(snapshot.amount) : "—";
  const term =
    typeof snapshot.termDays === "number" ? String(snapshot.termDays) : "—";
  const status =
    typeof snapshot.status === "string" ? snapshot.status : "—";
  const depositAt =
    typeof snapshot.depositAt === "string"
      ? isoToDatetimeLocalValue(snapshot.depositAt).replace("T", " ")
      : "—";
  return `${name} · ${amount} · ${term}d · ${depositAt} · ${status}`;
}

/** Same fields as `formatSnapshotLine`, rendered per-field so conflicting ones can be bolded. */
function SnapshotFields({
  snapshot,
  diffKeys,
}: {
  snapshot: Record<string, unknown>;
  diffKeys: Set<string>;
}) {
  const name =
    typeof snapshot.commanderName === "string" ? snapshot.commanderName : "—";
  const allianceTag =
    typeof snapshot.allianceTag === "string" ? snapshot.allianceTag : "—";
  const amount =
    typeof snapshot.amount === "number" ? String(snapshot.amount) : "—";
  const term =
    typeof snapshot.termDays === "number" ? `${snapshot.termDays}d` : "—";
  const status = typeof snapshot.status === "string" ? snapshot.status : "—";
  const depositAt =
    typeof snapshot.depositAt === "string"
      ? isoToDatetimeLocalValue(snapshot.depositAt).replace("T", " ")
      : "—";

  const fieldClass = (key: string) =>
    diffKeys.has(key) ? "font-semibold text-hq-danger" : undefined;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span>{name}</span>
      <span aria-hidden>·</span>
      <span className={fieldClass("allianceTag")}>{allianceTag}</span>
      <span aria-hidden>·</span>
      <span className={fieldClass("amount")}>{amount}</span>
      <span aria-hidden>·</span>
      <span className={fieldClass("termDays")}>{term}</span>
      <span aria-hidden>·</span>
      <span className={fieldClass("depositAt")}>{depositAt}</span>
      <span aria-hidden>·</span>
      <span className={fieldClass("status")}>{status}</span>
    </span>
  );
}

export function DepositSlipVideoReviewTable({
  rows,
  filterQuery,
  dedupeReport = null,
  onUpdateRow,
  onDeleteRow,
  onPreviewFrame,
  rowCanVideoPreview,
}: Props) {
  const t = useTranslations("videoReview");
  const tBanks = useTranslations("bankManagement");
  const [sortKey, setSortKey] = useState<SortKey>("depositAt");
  const [autoDedupeOpen, setAutoDedupeOpen] = useState(false);

  const report = isDedupeReport(dedupeReport) ? dedupeReport : null;

  const activeRows = useMemo(
    () => rows.filter((row) => row.deleted !== 1),
    [rows],
  );

  const validation = useMemo(
    () => validateDepositSlipReviewRows(activeRows, report),
    [activeRows, report],
  );
  const incompleteRowIds = validation.incompleteRowIds;
  const incompleteFieldsByRowId = validation.incompleteFieldsByRowId;
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
        (c): c is DedupeCluster => c.disposition === "auto_merged",
      ),
    [report],
  );

  const unresolvedFlaggedClusters = useMemo(
    () =>
      (report?.clusters ?? []).filter(
        (c): c is DedupeCluster =>
          c.disposition === "flagged" && unresolvedClusterIds.has(c.clusterId),
      ),
    [report, unresolvedClusterIds],
  );

  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    let list = activeRows;
    if (q) {
      list = list.filter((row) => {
        const haystack = [
          row.ocrName,
          row.allianceRankTitle ?? "",
          row.score ?? "",
          row.profession ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return [...list].sort((a, b) => {
      if (sortKey === "commander") {
        return a.ocrName.localeCompare(b.ocrName, undefined, {
          sensitivity: "base",
        });
      }
      const aMs = a.powerLevel ? Date.parse(a.powerLevel) : 0;
      const bMs = b.powerLevel ? Date.parse(b.powerLevel) : 0;
      return bMs - aMs;
    });
  }, [activeRows, filterQuery, sortKey]);

  const { pairs: terminalPairs } = useMemo(
    () => pairDepositSlipTerminalRows(filteredRows),
    [filteredRows],
  );

  const pairByRowId = useMemo(() => {
    const map = new Map<
      string,
      { locked: DepositSlipVideoReviewRow; terminal: DepositSlipVideoReviewRow }
    >();
    for (const pair of terminalPairs) {
      map.set(pair.locked.id, pair);
      map.set(pair.terminal.id, pair);
    }
    return map;
  }, [terminalPairs]);

  /**
   * Groups the sorted/filtered rows into standalone rows and locked+terminal
   * pairs, preserving the current sort order for where each group appears
   * (a pair surfaces wherever its earliest-sorted member would have).
   */
  const displayGroups = useMemo(() => {
    const rendered = new Set<string>();
    const groups: (
      | { kind: "single"; row: DepositSlipVideoReviewRow }
      | {
          kind: "pair";
          locked: DepositSlipVideoReviewRow;
          terminal: DepositSlipVideoReviewRow;
        }
    )[] = [];
    for (const row of filteredRows) {
      if (rendered.has(row.id)) continue;
      const pair = pairByRowId.get(row.id);
      if (pair) {
        rendered.add(pair.locked.id);
        rendered.add(pair.terminal.id);
        groups.push({ kind: "pair", locked: pair.locked, terminal: pair.terminal });
      } else {
        rendered.add(row.id);
        groups.push({ kind: "single", row });
      }
    }
    return groups;
  }, [filteredRows, pairByRowId]);

  function flagReasonLabel(reason: string): string {
    if (isFlagReasonKey(reason)) {
      return t(`depositSlipFlagReason.${reason}`);
    }
    return t("depositSlipFlaggedRow");
  }

  return (
    <div className="space-y-3">
      {report && report.autoMergedCount > 0 ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface-muted/40 p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-hq-fg">
                {t("depositSlipAutoDedupeTitle", {
                  count: report.autoMergedCount,
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
                        {formatSnapshotLine(destination.snapshot)}
                      </p>
                    ) : null}
                    {cluster.correctedFields && cluster.correctedFields.length > 0 ? (
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

      {unresolvedFlaggedClusters.length > 0 ? (
        <div className="rounded-xl border border-hq-danger/40 bg-[#f8514915] p-4 text-sm text-hq-danger">
          <p className="font-medium">
            {t("depositSlipFlaggedTitle", {
              count: unresolvedFlaggedClusters.length,
            })}
          </p>
          <p className="mt-2 text-hq-fg">{t("depositSlipFlaggedHint")}</p>
          <ul className="mt-3 space-y-3">
            {unresolvedFlaggedClusters.map((cluster) => {
              const diffKeys = clusterDiffKeys(cluster);
              return (
                <li
                  key={cluster.clusterId}
                  className="rounded-lg border border-hq-danger/30 bg-hq-canvas p-3 text-hq-fg"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-hq-danger">
                    {flagReasonLabel(cluster.reason)}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {cluster.members.map((member) => (
                      <li
                        key={member.slipId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-hq-surface-muted/40 px-2 py-1.5"
                      >
                        <SnapshotFields
                          snapshot={member.snapshot}
                          diffKeys={diffKeys}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            for (const slipId of otherClusterMemberSlipIds(
                              cluster,
                              member.slipId,
                            )) {
                              onDeleteRow(slipId);
                            }
                          }}
                          className="whitespace-nowrap rounded-md border border-hq-border px-2 py-1 text-xs text-hq-fg hover:bg-hq-surface-muted"
                        >
                          {t("depositSlipFlaggedKeepThisOne")}
                        </button>
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

      <div className="overflow-x-auto rounded-xl border border-hq-border" role="table">
        <div className="min-w-[52rem]">
          <div
            role="row"
            className="grid gap-x-2 bg-hq-surface-muted px-3 py-2 text-xs font-medium uppercase tracking-wide text-hq-fg-muted"
            style={{ gridTemplateColumns: ROW_GRID_TEMPLATE }}
          >
            <span role="columnheader">{tBanks("fields.commanderName")}</span>
            <span role="columnheader">{tBanks("fields.allianceTag")}</span>
            <span role="columnheader">{tBanks("fields.amount")}</span>
            <span role="columnheader">{tBanks("fields.termDays")}</span>
            <span role="columnheader">{tBanks("fields.depositAt")}</span>
            <span role="columnheader">{tBanks("fields.status")}</span>
            <span role="columnheader" />
          </div>

          <div className="divide-y divide-hq-border">
            {displayGroups.map((group) => {
              if (group.kind === "single") {
                return renderRow(group.row);
              }
              // Pairing only ever produces "matured"/"looted" terminal rows.
              const terminalStatus: "matured" | "looted" =
                group.terminal.profession === "looted" ? "looted" : "matured";
              const borderClass = TERMINAL_GROUP_BORDER_CLASS[terminalStatus];
              return (
                <div
                  key={`pair-${group.locked.id}-${group.terminal.id}`}
                  className="p-2"
                >
                  <div
                    className={`space-y-1 rounded-xl border-4 p-1.5 ${borderClass}`}
                  >
                    <p className="px-2 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                      {t("depositSlipGroupedPairLabel", {
                        status: tBanks(`status.${terminalStatus}`).toLowerCase(),
                      })}
                    </p>
                    {renderRow(group.locked, { rounded: true })}
                    {renderRow(group.terminal, { rounded: true })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  function renderRow(
    row: DepositSlipVideoReviewRow,
    opts?: { rounded?: boolean },
  ) {
    const canPreview = rowCanVideoPreview?.(row.frameIndex) && onPreviewFrame;
    const incompleteFields: Set<DepositSlipRequiredFieldKey> =
      incompleteFieldsByRowId.get(row.id) ?? new Set();
    const isIncomplete = incompleteFields.size > 0;
    const isFlagged =
      Boolean(row.dedupeClusterId) &&
      unresolvedClusterIds.has(row.dedupeClusterId!);
    const flagReason = row.dedupeClusterId
      ? flaggedReasonByClusterId.get(row.dedupeClusterId)
      : undefined;
    const status = normalizedRowStatus(row.profession);

    const fieldBorderClass = (key: DepositSlipRequiredFieldKey) =>
      incompleteFields.has(key)
        ? "border-hq-danger"
        : "border-hq-border";

    return (
      <div
        key={row.id}
        role="row"
        className={[
          "grid gap-x-2 px-3 py-2",
          STATUS_ROW_BG_CLASS[status],
          opts?.rounded ? "rounded-lg" : "",
          isFlagged ? "border-2 border-hq-danger" : "border-2 border-transparent",
        ].join(" ")}
        style={{ gridTemplateColumns: ROW_GRID_TEMPLATE }}
      >
        <div role="cell" className="align-top">
          <input
            type="text"
            value={row.ocrName}
            onChange={(e) => onUpdateRow(row.id, { ocrName: e.target.value })}
            className={`w-full min-w-[8rem] rounded-md border bg-hq-canvas px-2 py-1.5 ${fieldBorderClass("ocrName")}`}
          />
          {isFlagged ? (
            <p className="mt-1 text-xs text-hq-danger">
              {flagReason ? flagReasonLabel(flagReason) : t("depositSlipFlaggedRow")}
            </p>
          ) : null}
          {isIncomplete ? (
            <p className="mt-1 text-xs text-[#d29922]">
              {t("depositSlipIncompleteRow")}
            </p>
          ) : null}
        </div>
        <div role="cell" className="align-top">
          <input
            type="text"
            value={row.allianceRankTitle ?? ""}
            onChange={(e) =>
              onUpdateRow(row.id, { allianceRankTitle: e.target.value || null })
            }
            className="w-full min-w-[4rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5"
          />
        </div>
        <div role="cell" className="align-top">
          <input
            type="text"
            inputMode="numeric"
            value={row.score ?? ""}
            onChange={(e) =>
              onUpdateRow(row.id, { score: e.target.value || null })
            }
            className={`w-full min-w-[5rem] rounded-md border bg-hq-canvas px-2 py-1.5 font-mono ${fieldBorderClass("score")}`}
          />
        </div>
        <div
          role="cell"
          className={
            incompleteFields.has("memberLevel")
              ? "align-top rounded-lg ring-2 ring-hq-danger"
              : "align-top"
          }
        >
          <AppSelect
            value={row.memberLevel != null ? String(row.memberLevel) : ""}
            onChange={(next) => {
              const n = Number(next);
              onUpdateRow(row.id, {
                memberLevel:
                  next && (DEPOSIT_TERMS as readonly number[]).includes(n)
                    ? (n as DepositTermDays)
                    : null,
              });
            }}
            aria-label={tBanks("fields.termDays")}
            options={DEPOSIT_TERMS.map((term) => ({
              value: String(term),
              label: String(term),
            }))}
          />
        </div>
        <div role="cell" className="align-top">
          <input
            type="datetime-local"
            value={isoToDatetimeLocalValue(row.powerLevel)}
            onChange={(e) =>
              onUpdateRow(row.id, {
                powerLevel: datetimeLocalToIso(e.target.value),
              })
            }
            className={`w-full min-w-[11rem] rounded-md border bg-hq-canvas px-2 py-1.5 ${fieldBorderClass("powerLevel")}`}
          />
        </div>
        <div role="cell" className="align-top">
          <AppSelect
            value={row.profession ?? "locked"}
            onChange={(next) =>
              onUpdateRow(row.id, {
                profession: (DEPOSIT_STATUSES as readonly string[]).includes(
                  next,
                )
                  ? (next as DepositStatus)
                  : "locked",
              })
            }
            aria-label={tBanks("fields.status")}
            options={DEPOSIT_STATUSES.map((s) => ({
              value: s,
              label: tBanks(`status.${s}`),
            }))}
          />
        </div>
        <div role="cell" className="align-top">
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
        </div>
      </div>
    );
  }
}

export function useDepositSlipReviewValidation(
  rows: DepositSlipVideoReviewRow[],
  dedupeReport?: DedupeReport | null,
) {
  const report = isDedupeReport(dedupeReport) ? dedupeReport : null;
  return validateDepositSlipReviewRows(rows, report);
}
