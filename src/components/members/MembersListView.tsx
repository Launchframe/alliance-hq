"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import { Link } from "@/i18n/navigation";
import {
  formatMemberRankDisplay,
  isAshedMemberUnranked,
  parseAshedMemberAllianceRank,
} from "@/lib/members/alliance-rank";
import {
  patchMembersAfterBulkRank,
  type BulkMemberRankAction,
} from "@/lib/members/bulk-rank-update.shared";
import type { AllianceMembersPayload } from "@/lib/members/load";
import type { AshedMember } from "@/lib/video/member-matcher";
import { ashedUrlForPath } from "@/lib/nav/routes";

type Props = {
  initial: AllianceMembersPayload;
  canEditRanks?: boolean;
};

function memberStatusLabel(
  status: string | undefined,
  t: (key: "statusActive" | "statusFormer") => string,
): string {
  if (status === "former") {
    return t("statusFormer");
  }
  if (status === "active" || !status) {
    return t("statusActive");
  }
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function memberStatusBadgeClass(status?: string): string {
  const base =
    "inline-flex min-w-[5.5rem] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (status === "former") {
    return `${base} bg-[#30363d] text-[#8b949e] ring-1 ring-[#484f58]`;
  }
  return `${base} bg-[#23863633] text-[#3fb950] ring-1 ring-[#23863666]`;
}

function memberRankFields(
  member: AshedMember,
  unknownLabel: string,
): { rankLabel: string; titleLabel: string } {
  return formatMemberRankDisplay(
    parseAshedMemberAllianceRank(member),
    unknownLabel,
  );
}

export function MembersListView({ initial, canEditRanks = false }: Props) {
  const t = useTranslations("members");
  const formatDateTime = useFormatAccountDateTime();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [showFormer, setShowFormer] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [applying, setApplying] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.members.filter((member) => {
      if (!showFormer && member.status === "former") {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = [
        member.current_name,
        ...(member.previous_names ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [data.members, query, showFormer]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((memberId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(filtered.map((m) => m.id)));
  }, [filtered]);

  const selectUnrankedFiltered = useCallback(() => {
    setSelectedIds(
      new Set(filtered.filter((m) => isAshedMemberUnranked(m)).map((m) => m.id)),
    );
  }, [filtered]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/members");
      const body = (await res.json()) as AllianceMembersPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("loadFailed"));
        return;
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  const applyBulkRank = useCallback(
    async (action: BulkMemberRankAction, allianceRank?: number) => {
      if (selectedIds.size === 0 || applying) return;

      const memberIds = [...selectedIds];
      setApplying(true);
      setError(null);

      try {
        const res = await fetch("/api/members/ranks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberIds, action, allianceRank }),
        });
        const body = (await res.json()) as {
          error?: string;
          updated?: number;
          results?: Array<{ ok: boolean }>;
        };

        if (!res.ok) {
          setError(body.error ?? t("bulkRankFailed"));
          return;
        }

        const updated = body.updated ?? 0;
        const total = memberIds.length;

        setData((prev) => ({
          ...prev,
          members: patchMembersAfterBulkRank(prev.members, {
            memberIds,
            action,
            allianceRank,
          }),
        }));
        setSelectedIds(new Set());

        if (updated === total) {
          setError(null);
        } else if (updated > 0) {
          setError(t("bulkRankPartial", { updated, total }));
        } else {
          setError(t("bulkRankFailed"));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("bulkRankFailed"));
      } finally {
        setApplying(false);
      }
    },
    [applying, selectedIds, t],
  );

  const ashedMembersUrl = ashedUrlForPath("/members");
  const tableColSpan = editMode ? 7 : 6;
  const selectedCount = selectedIds.size;
  const bulkDisabled = selectedCount === 0 || applying;

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
          <p className="mt-2 text-sm">
            {t("allianceLine", {
              tag: data.alliance.tag,
              name: data.alliance.name ?? data.alliance.tag,
            })}
          </p>
          <p className="mt-1 text-xs text-[#8b949e]">
            {t("counts", {
              active: data.counts.active,
              former: data.counts.former,
              total: data.counts.total,
            })}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {canEditRanks && (
            <button
              type="button"
              onClick={() => (editMode ? exitEditMode() : setEditMode(true))}
              className="w-full rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] hover:bg-[#388bfd]/20 sm:w-auto"
            >
              {editMode ? t("doneEditing") : t("editRanks")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="w-full rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm disabled:opacity-50 sm:w-auto"
          >
            {refreshing ? t("refreshing") : t("refresh")}
          </button>
          <a
            href={ashedMembersUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm text-white hover:bg-[#2ea043] sm:w-auto"
          >
            {t("openInAshed")}
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-xs text-[#8b949e]">{t("search")}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[#8b949e] sm:pt-5">
          <input
            type="checkbox"
            checked={showFormer}
            onChange={(e) => setShowFormer(e.target.checked)}
          />
          {t("showFormer")}
        </label>
      </div>

      {editMode && (
        <div className="flex flex-col gap-3 rounded-xl border border-[#388bfd]/40 bg-[#388bfd]/5 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-[#58a6ff]">
              {t("selectedCount", { count: selectedCount })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllFiltered}
                className="rounded-lg border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-xs hover:bg-[#30363d]"
              >
                {t("selectAll")}
              </button>
              <button
                type="button"
                onClick={selectUnrankedFiltered}
                className="rounded-lg border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-xs hover:bg-[#30363d]"
              >
                {t("selectUnranked")}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {([1, 2, 3] as const).map((rank) => (
              <button
                key={rank}
                type="button"
                disabled={bulkDisabled}
                onClick={() => void applyBulkRank("set", rank)}
                className="rounded-lg border border-[#238636] bg-[#238636] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {t(`setRankR${rank}` as "setRankR1" | "setRankR2" | "setRankR3")}
              </button>
            ))}
            <button
              type="button"
              disabled={bulkDisabled}
              onClick={() => void applyBulkRank("clear")}
              className="rounded-lg border border-[#f85149]/50 bg-[#f85149]/10 px-3 py-1.5 text-xs text-[#f85149] disabled:opacity-40"
            >
              {applying ? t("applyingRanks") : t("removeRank")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[#f85149]">{error}</p>}

      <p className="text-xs text-[#8b949e]">
        {t("lastSynced", {
          time: formatDateTime(data.fetchedAt),
        })}
      </p>

      <div className="min-w-0 overflow-hidden rounded-xl border border-[#30363d]">
        <table className="w-full min-w-0 table-fixed text-left text-sm md:table-auto">
          <thead className="border-b border-[#30363d] bg-[#161b22] text-xs uppercase tracking-wide text-[#8b949e]">
            <tr>
              {editMode && (
                <th className="hidden w-10 px-2 py-3 md:table-cell" aria-hidden />
              )}
              <th className="px-3 py-3 font-medium md:hidden sm:px-4">
                {t("colName")}
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                {t("colName")}
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                {t("colPreviousNames")}
              </th>
              <th className="hidden px-4 py-3 text-center font-medium md:table-cell">
                {t("colRank")}
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                {t("colTitle")}
              </th>
              <th className="hidden px-4 py-3 text-center font-medium md:table-cell">
                {t("colStatus")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className="px-3 py-8 text-center text-[#8b949e] sm:px-4"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : (
              filtered.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  editMode={editMode}
                  selected={selectedIds.has(member.id)}
                  onToggleSelect={() => toggleSelected(member.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MemberRowProps = {
  member: AshedMember;
  editMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
};

function MemberRow({
  member,
  editMode,
  selected,
  onToggleSelect,
}: MemberRowProps) {
  const t = useTranslations("members");
  const previous =
    member.previous_names?.filter(Boolean).join(", ") || t("noPreviousNames");
  const unknown = t("noPreviousNames");
  const { rankLabel, titleLabel } = memberRankFields(member, unknown);
  const statusLabel = memberStatusLabel(member.status, t);
  const statusBadge = (
    <span className={memberStatusBadgeClass(member.status)}>
      {statusLabel}
    </span>
  );

  const rowClass = [
    "border-b border-[#30363d]/60 last:border-0",
    editMode ? "cursor-pointer" : "hover:bg-[#161b22]/80",
    selected ? "bg-[#388bfd]/15 ring-1 ring-inset ring-[#388bfd]/35" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const selectionControl = editMode ? (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggleSelect}
      onClick={(e) => e.stopPropagation()}
      aria-label={t("selectMember", { name: member.current_name })}
      className="size-4 shrink-0 rounded border-[#484f58] bg-[#0d1117] accent-[#388bfd]"
    />
  ) : null;

  return (
    <tr
      className={rowClass}
      onClick={editMode ? onToggleSelect : undefined}
      aria-selected={editMode ? selected : undefined}
    >
      {editMode && (
        <td className="hidden px-2 py-3 text-center md:table-cell">
          {selectionControl}
        </td>
      )}
      <td className="px-3 py-3 md:hidden sm:px-4">
        <div className="flex min-w-0 items-start gap-3">
          {editMode && selectionControl}
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <div className="wrap-break-word font-medium">{member.current_name}</div>
            <div className="wrap-break-word text-xs text-[#8b949e]">
              <span className="font-medium text-[#6e7681]">
                {t("colPreviousNames")}:{" "}
              </span>
              {previous}
            </div>
            <div className="text-xs text-[#8b949e]">
              <span className="font-medium text-[#6e7681]">{t("colRank")}: </span>
              <span className="font-mono">{rankLabel}</span>
            </div>
            <div className="text-xs text-[#8b949e]">
              <span className="font-medium text-[#6e7681]">{t("colTitle")}: </span>
              {titleLabel}
            </div>
            {statusBadge}
          </div>
        </div>
      </td>
      <td className="hidden px-4 py-3 font-medium md:table-cell">
        {member.current_name}
      </td>
      <td className="hidden wrap-break-word px-4 py-3 text-[#8b949e] md:table-cell">
        {previous}
      </td>
      <td className="hidden px-4 py-3 text-center font-mono md:table-cell">
        {rankLabel}
      </td>
      <td className="hidden px-4 py-3 text-[#8b949e] md:table-cell">
        {titleLabel}
      </td>
      <td className="hidden px-4 py-3 text-center md:table-cell">
        {statusBadge}
      </td>
    </tr>
  );
}

function MembersListMissingTag() {
  const t = useTranslations("members");
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-6">
      <h1 className="text-xl font-semibold text-[#e3b341]">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">{t("missingTag")}</p>
      <Link
        href="/settings"
        className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
      >
        {t("goToSettings")}
      </Link>
    </div>
  );
}

export function MembersListViewOrSetup(
  props: Props | { missingTag: true },
) {
  if ("missingTag" in props) {
    return <MembersListMissingTag />;
  }
  return <MembersListView initial={props.initial} canEditRanks={props.canEditRanks} />;
}
