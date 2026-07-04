"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import { MembersGalleryView } from "@/components/members/MembersGalleryView";
import { RosterImportDialog } from "@/components/members/RosterImportDialog";
import { CommanderConflictResolutionSheet } from "@/components/members/CommanderConflictResolutionSheet";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
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
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import { ashedUrlForPath } from "@/lib/nav/routes";
import {
  writeStoredMembersListFilters,
} from "@/lib/members/members-list-filters.shared";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

type MembersListViewMode = "table" | "gallery";

type Props = {
  initial: AllianceMembersPayload;
  canEditRanks?: boolean;
  canImportMembers?: boolean;
  /** Ashed-mode live sync — only when session has an Ashed credential. */
  canRefreshFromAshed?: boolean;
  canUploadRosterVideo?: boolean;
};

const SEARCH_DEBOUNCE_MS = 300;

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

export function MembersListView({
  initial,
  canEditRanks = false,
  canImportMembers = false,
  canRefreshFromAshed = false,
  canUploadRosterVideo = false,
}: Props) {
  const t = useTranslations("members");
  const formatDateTime = useFormatAccountDateTime();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("q") ?? "",
  );
  const [query, setQuery] = useState(() => (searchParams.get("q") ?? "").trim());
  const [showFormer, setShowFormer] = useState(
    () => searchParams.get("former") === "1",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [applying, setApplying] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [conflictSheetOpen, setConflictSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<MembersListViewMode>("table");
  const skipInitialSearchFetch = useRef(true);

  const pendingConflictCount = useMemo(() => {
    const fromPayload = data.commanderConflicts?.length ?? 0;
    if (fromPayload > 0) return fromPayload;
    return data.members.filter((m) => m.commander_sync_status === "name_conflict")
      .length;
  }, [data.commanderConflicts, data.members]);

  const isNative = initial.operatingMode === "native";
  const showRefresh = isNative || canRefreshFromAshed;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    const q = searchInput.trim();
    if (q) params.set("q", q);
    if (showFormer) params.set("former", "1");
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }
    writeStoredMembersListFilters({ searchInput, showFormer });
  }, [searchInput, showFormer, pathname, router, searchParams]);

  const filtered = useMemo(() => {
    return data.members.filter((member) => {
      if (!showFormer && member.status === "former") {
        return false;
      }
      return true;
    });
  }, [data.members, showFormer]);

  useEffect(() => {
    if (skipInitialSearchFetch.current) {
      skipInitialSearchFetch.current = false;
      if (!query && !showFormer) return;
    }
    let cancelled = false;
    const load = async () => {
      setRefreshing(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (showFormer) params.set("includeFormer", "1");
        const qs = params.toString();
        const res = await fetch(`/api/members${qs ? `?${qs}` : ""}`);
        const body = (await res.json()) as AllianceMembersPayload & {
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) setError(body.error ?? t("loadFailed"));
          return;
        }
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("loadFailed"));
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [query, showFormer, t]);

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
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (showFormer) params.set("includeFormer", "1");
      const qs = params.toString();
      const res = await fetch(`/api/members${qs ? `?${qs}` : ""}`);
      const body = (await res.json()) as AllianceMembersPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("loadFailed"));
        return;
      }
      setData(body);
      const conflictCount =
        body.commanderConflicts?.length ??
        body.members.filter((m) => m.commander_sync_status === "name_conflict")
          .length;
      if (conflictCount > 0) {
        setConflictSheetOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [query, showFormer, t]);

  const applyBulkRank = useCallback(
    async (action: BulkMemberRankAction, allianceRank?: number) => {
      if (selectedIds.size === 0 || applying) return;

      const memberIds = [...selectedIds];
      const patchInput = { memberIds, action, allianceRank };

      setApplying(true);
      setError(null);

      let previousMembers: AshedMember[] = [];
      setData((prev) => {
        previousMembers = prev.members;
        return {
          ...prev,
          members: patchMembersAfterBulkRank(prev.members, patchInput),
        };
      });
      setSelectedIds(new Set());

      try {
        const res = await fetch("/api/members/ranks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberIds, action, allianceRank }),
        });
        const body = (await res.json()) as {
          error?: string;
          updated?: number;
          results?: Array<{ ashedMemberId: string; ok: boolean }>;
        };

        if (!res.ok) {
          setData((prev) => ({ ...prev, members: previousMembers }));
          setError(body.error ?? t("bulkRankFailed"));
          return;
        }

        const updated = body.updated ?? 0;
        const total = memberIds.length;
        const okIds =
          body.results?.filter((result) => result.ok).map((r) => r.ashedMemberId) ??
          (updated === total ? memberIds : []);

        if (updated < total) {
          setData((prev) => ({
            ...prev,
            members: patchMembersAfterBulkRank(previousMembers, {
              memberIds: okIds,
              action,
              allianceRank,
            }),
          }));
        }

        if (updated === total) {
          setError(null);
        } else if (updated > 0) {
          setError(t("bulkRankPartial", { updated, total }));
        } else {
          setData((prev) => ({ ...prev, members: previousMembers }));
          setError(t("bulkRankFailed"));
        }
      } catch (e) {
        setData((prev) => ({ ...prev, members: previousMembers }));
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
          <p className="mt-1 text-sm text-[#8b949e]">
            {isNative ? t("subtitleNative") : t("subtitle")}
          </p>
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
          {canImportMembers && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white hover:bg-[#2ea043] sm:w-auto"
            >
              {t("importMembers")}
            </button>
          )}
          {canUploadRosterVideo && (
            <Link
              href={buildVideoUploadHref(MEMBER_ROSTER_VIDEO_SCORE_TARGET)}
              className="w-full rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-center text-sm text-[#58a6ff] hover:bg-[#388bfd]/20 sm:w-auto"
            >
              {t("uploadRosterVideo")}
            </Link>
          )}
          {canEditRanks && (
            <Link
              href="/members/roster-link-requests"
              className="w-full rounded-lg border border-[#30363d] px-4 py-2 text-center text-sm text-[#e6edf3] hover:bg-[#21262d] sm:w-auto"
            >
              {t("rosterLinkRequests")}
            </Link>
          )}
          {canEditRanks && (
            <Link
              href="/members/member-link-help"
              className="w-full rounded-lg border border-[#30363d] px-4 py-2 text-center text-sm text-[#e6edf3] hover:bg-[#21262d] sm:w-auto"
            >
              {t("memberLinkHelpRequests")}
            </Link>
          )}
          {canEditRanks && (
            <button
              type="button"
              onClick={() => (editMode ? exitEditMode() : setEditMode(true))}
              className="w-full rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] hover:bg-[#388bfd]/20 sm:w-auto"
            >
              {editMode ? t("doneEditing") : t("editRanks")}
            </button>
          )}
          {showRefresh ? (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="w-full rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm disabled:opacity-50 sm:w-auto"
            >
              {refreshing
                ? isNative
                  ? t("refreshingNative")
                  : t("refreshing")
                : isNative
                  ? t("refreshNative")
                  : t("refresh")}
            </button>
          ) : null}
          {!isNative && (
          <a
            href={ashedMembersUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm text-white hover:bg-[#2ea043] sm:w-auto"
          >
            {t("openInAshed")}
          </a>
          )}
        </div>
      </div>

      {canImportMembers && (
        <RosterImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          members={data.members}
          allianceTag={data.alliance.tag}
          gameServerNumber={data.gameServerNumber}
          onCommitted={() => void refresh()}
        />
      )}

      {pendingConflictCount > 0 && canImportMembers ? (
        <div
          className="flex flex-col gap-3 rounded-xl border border-[#f85149]/40 bg-[#f8514911] p-4 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div>
            <p className="text-sm font-medium text-[#f85149]">
              {t("commanderConflicts.bannerTitle", { count: pendingConflictCount })}
            </p>
            <p className="mt-1 text-xs text-[#8b949e]">
              {t("commanderConflicts.bannerDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConflictSheetOpen(true)}
            className="w-full shrink-0 rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514922] sm:w-auto"
          >
            {t("commanderConflicts.resolve")}
          </button>
        </div>
      ) : null}

      <CommanderConflictResolutionSheet
        open={conflictSheetOpen}
        onOpenChange={setConflictSheetOpen}
        conflicts={data.commanderConflicts ?? []}
        members={data.members}
        gameServerNumber={data.gameServerNumber}
        onResolved={() => void refresh()}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-xs text-[#8b949e]">{t("search")}</span>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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
        <div className="flex items-center gap-1 self-end rounded-lg border border-[#30363d] bg-[#0d1117] p-1 sm:pt-5">
          <button
            type="button"
            aria-pressed={viewMode === "table"}
            onClick={() => setViewMode("table")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              viewMode === "table"
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {t("viewTable")}
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "gallery"}
            onClick={() => setViewMode("gallery")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              viewMode === "gallery"
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {t("viewGallery")}
          </button>
        </div>
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
            {([1, 2, 3, 4] as const).map((rank) => (
              <button
                key={rank}
                type="button"
                disabled={bulkDisabled}
                onClick={() => void applyBulkRank("set", rank)}
                className="rounded-lg border border-[#238636] bg-[#238636] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {t(
                  `setRankR${rank}` as
                    | "setRankR1"
                    | "setRankR2"
                    | "setRankR3"
                    | "setRankR4",
                )}
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

      {viewMode === "gallery" ? (
        <MembersGalleryView
          members={data.members}
          allianceTag={data.alliance.tag}
          searchQuery={query}
          showFormer={showFormer}
          emptyLabel={t("empty")}
          rankUnknownLabel={t("noPreviousNames")}
        />
      ) : (
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
      )}
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

  const nameContent = editMode ? (
    member.current_name
  ) : (
    <Link
      href={`/members/${member.id}`}
      className="text-[#58a6ff] hover:underline"
    >
      {member.current_name}
    </Link>
  );

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
            <div className="wrap-break-word font-medium">{nameContent}</div>
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
        {nameContent}
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
        href="/account"
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
  return (
    <MembersListView
      initial={props.initial}
      canEditRanks={props.canEditRanks}
      canImportMembers={props.canImportMembers}
      canRefreshFromAshed={props.canRefreshFromAshed}
      canUploadRosterVideo={props.canUploadRosterVideo}
    />
  );
}
