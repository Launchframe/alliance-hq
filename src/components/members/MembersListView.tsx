"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import { CommanderConflictResolutionSheet } from "@/components/members/CommanderConflictResolutionSheet";
import {
  RosterCommanderFilterBar,
  RosterSquadSummaryStrip,
} from "@/components/members/RosterCommanderToolbar";
import { RosterColumnVisibilityMenu } from "@/components/members/RosterColumnVisibilityMenu";
import {
  rosterColumnHeaderLabel,
  RosterMemberRow,
} from "@/components/members/RosterMemberRow";
import { RosterImportDialog } from "@/components/members/RosterImportDialog";
import { RosterTeamBuilderSection } from "@/components/members/RosterTeamBuilderSection";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type {
  CommanderIndexHqLinkFilter,
  CommanderIndexPayload,
} from "@/lib/commanders/index.shared";
import type { MainSquadType } from "@/lib/commanders/main-squad.shared";
import { isAshedMemberUnranked } from "@/lib/members/alliance-rank";
import {
  patchMembersAfterBulkRank,
  type BulkMemberRankAction,
} from "@/lib/members/bulk-rank-update.shared";
import type { AllianceMembersPayload } from "@/lib/members/load";
import { writeStoredMembersListFilters } from "@/lib/members/members-list-filters.shared";
import {
  mergeMembersWithCommanderIndex,
  rosterRowMatchesCommanderFilters,
  sortRosterRows,
  visibleRosterColumns,
  type RosterColumnId,
  type RosterSortDir,
  type RosterSortKey,
} from "@/lib/members/roster-index.shared";
import {
  resolveRosterColumnVisibility,
  toggleRosterColumnVisibility,
  writeStoredRosterColumnPrefs,
} from "@/lib/members/roster-column-prefs.shared";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import { ashedUrlForPath } from "@/lib/nav/routes";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

type Props = {
  initial: AllianceMembersPayload;
  commanderInitial: CommanderIndexPayload;
  canEditRanks?: boolean;
  canImportMembers?: boolean;
  canRefreshFromAshed?: boolean;
  canUploadRosterVideo?: boolean;
};

const SEARCH_DEBOUNCE_MS = 300;

const SORTABLE_COLUMNS: Partial<Record<RosterColumnId, RosterSortKey>> = {
  name: "name",
  thp: "thp",
  mainSquad: "squad",
  inGameRank: "allianceRank",
  vr: "vr",
  allianceRank: "allianceRank",
  status: "status",
};

export function MembersListView({
  initial,
  commanderInitial,
  canEditRanks = false,
  canImportMembers = false,
  canRefreshFromAshed = false,
  canUploadRosterVideo = false,
}: Props) {
  const t = useTranslations("members");
  const tCommanders = useTranslations("commandersIndex");
  const formatDateTime = useFormatAccountDateTime();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState(initial);
  const [commanderData, setCommanderData] =
    useState<CommanderIndexPayload>(commanderInitial);
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
  const skipInitialSearchFetch = useRef(true);

  const [filterSquad, setFilterSquad] = useState<MainSquadType | "">("");
  const [filterHqLink, setFilterHqLink] =
    useState<CommanderIndexHqLinkFilter>("all");
  const [filterMinThp, setFilterMinThp] = useState("");
  const [includeUnreported, setIncludeUnreported] = useState(true);
  const [sortKey, setSortKey] = useState<RosterSortKey>("name");
  const [sortDir, setSortDir] = useState<RosterSortDir>("asc");

  const [pendingSquad, setPendingSquad] = useState<
    Record<string, MainSquadType | "">
  >({});
  const [savingSquad, setSavingSquad] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});

  const showSquadEditColumn =
    commanderData.canEdit || commanderData.canSelfReportMemberIds.length > 0;

  const [columnVisibility, setColumnVisibility] = useState(() =>
    resolveRosterColumnVisibility({
      canWrite: canEditRanks,
      showSquadEdit: showSquadEditColumn,
    }),
  );

  useEffect(() => {
    setColumnVisibility(
      resolveRosterColumnVisibility({
        canWrite: canEditRanks,
        showSquadEdit: showSquadEditColumn,
      }),
    );
  }, [canEditRanks, showSquadEditColumn]);

  const visibleColumns = useMemo(
    () => visibleRosterColumns(columnVisibility),
    [columnVisibility],
  );

  const pendingConflictCount = useMemo(() => {
    const fromPayload = data.commanderConflicts?.length ?? 0;
    if (fromPayload > 0) return fromPayload;
    return data.members.filter((m) => m.commander_sync_status === "name_conflict")
      .length;
  }, [data.commanderConflicts, data.members]);

  const isNative = initial.operatingMode === "native";
  const showRefresh = isNative || canRefreshFromAshed;
  const minThpNum = filterMinThp.trim()
    ? Number.parseInt(filterMinThp.trim(), 10)
    : 0;

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

  const filteredMembers = useMemo(() => {
    return data.members.filter((member) => {
      if (!showFormer && member.status === "former") {
        return false;
      }
      return true;
    });
  }, [data.members, showFormer]);

  const rosterRows = useMemo(() => {
    const merged = mergeMembersWithCommanderIndex(
      filteredMembers,
      commanderData.rows,
    );
    const commanderFiltered = merged.filter((row) =>
      rosterRowMatchesCommanderFilters(row, {
        filterSquad,
        filterHqLink,
        filterMinThp: Number.isFinite(minThpNum) ? minThpNum : 0,
        includeUnreported,
      }),
    );
    return sortRosterRows(commanderFiltered, sortKey, sortDir);
  }, [
    filteredMembers,
    commanderData.rows,
    filterSquad,
    filterHqLink,
    minThpNum,
    includeUnreported,
    sortKey,
    sortDir,
  ]);

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
        const [membersRes, commandersRes] = await Promise.all([
          fetch(`/api/members${qs ? `?${qs}` : ""}`),
          fetch("/api/commanders/index"),
        ]);
        const membersBody = (await membersRes.json()) as AllianceMembersPayload & {
          error?: string;
        };
        const commandersBody =
          (await commandersRes.json()) as CommanderIndexPayload & {
            error?: string;
          };
        if (!membersRes.ok) {
          if (!cancelled) setError(membersBody.error ?? t("loadFailed"));
          return;
        }
        if (!commandersRes.ok) {
          if (!cancelled) {
            setError(commandersBody.error ?? tCommanders("loadFailed"));
          }
          return;
        }
        if (!cancelled) {
          setData(membersBody);
          setCommanderData(commandersBody);
        }
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
  }, [query, showFormer, t, tCommanders]);

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
    setSelectedIds(new Set(rosterRows.map((row) => row.ashedMemberId)));
  }, [rosterRows]);

  const selectUnrankedFiltered = useCallback(() => {
    setSelectedIds(
      new Set(
        rosterRows
          .filter((row) => isAshedMemberUnranked(row.member))
          .map((row) => row.ashedMemberId),
      ),
    );
  }, [rosterRows]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (showFormer) params.set("includeFormer", "1");
      const qs = params.toString();
      const [membersRes, commandersRes] = await Promise.all([
        fetch(`/api/members${qs ? `?${qs}` : ""}`),
        fetch("/api/commanders/index"),
      ]);
      const membersBody = (await membersRes.json()) as AllianceMembersPayload & {
        error?: string;
      };
      const commandersBody =
        (await commandersRes.json()) as CommanderIndexPayload & {
          error?: string;
        };
      if (!membersRes.ok) {
        setError(membersBody.error ?? t("loadFailed"));
        return;
      }
      if (!commandersRes.ok) {
        setError(commandersBody.error ?? tCommanders("loadFailed"));
        return;
      }
      setData(membersBody);
      setCommanderData(commandersBody);
      setPendingSquad({});
      setSaveError({});
      const conflictCount =
        membersBody.commanderConflicts?.length ??
        membersBody.members.filter(
          (m) => m.commander_sync_status === "name_conflict",
        ).length;
      if (conflictCount > 0) {
        setConflictSheetOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [query, showFormer, t, tCommanders]);

  const saveSquad = useCallback(
    async (ashedMemberId: string) => {
      const row = commanderData.rows.find(
        (entry) => entry.ashedMemberId === ashedMemberId,
      );
      if (!row) return;

      const squad = pendingSquad[ashedMemberId] ?? row.mainSquad ?? "";
      if (!squad) return;

      const isOwner =
        commanderData.canSelfReportMemberIds.includes(ashedMemberId);
      const method = isOwner && !commanderData.canEdit ? "POST" : "PATCH";

      setSavingSquad((prev) => ({ ...prev, [ashedMemberId]: true }));
      setSaveError((prev) => ({ ...prev, [ashedMemberId]: "" }));
      try {
        const res = await fetch(`/api/members/${ashedMemberId}/main-squad`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mainSquad: squad }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) {
          setSaveError((prev) => ({
            ...prev,
            [ashedMemberId]: body.error ?? tCommanders("saveFailed"),
          }));
          return;
        }
        setCommanderData((prev) => ({
          ...prev,
          rows: prev.rows.map((entry) =>
            entry.ashedMemberId === ashedMemberId
              ? {
                  ...entry,
                  mainSquad: squad as MainSquadType,
                  mainSquadSource: commanderData.canEdit
                    ? "officer_override"
                    : "self_report",
                }
              : entry,
          ),
        }));
        setPendingSquad((prev) => {
          const next = { ...prev };
          delete next[ashedMemberId];
          return next;
        });
      } catch (e) {
        setSaveError((prev) => ({
          ...prev,
          [ashedMemberId]:
            e instanceof Error ? e.message : tCommanders("saveFailed"),
        }));
      } finally {
        setSavingSquad((prev) => ({ ...prev, [ashedMemberId]: false }));
      }
    },
    [commanderData.canEdit, commanderData.canSelfReportMemberIds, commanderData.rows, pendingSquad, tCommanders],
  );

  const applyBulkRank = useCallback(
    async (action: BulkMemberRankAction, allianceRank?: number) => {
      if (selectedIds.size === 0 || applying) return;

      const memberIds = [...selectedIds];
      const patchInput = { memberIds, action, allianceRank };

      setApplying(true);
      setError(null);

      let previousMembers = data.members;
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
    [applying, data.members, selectedIds, t],
  );

  const toggleColumn = useCallback(
    (columnId: RosterColumnId, nextVisible: boolean) => {
      setColumnVisibility((prev) => {
        const next = toggleRosterColumnVisibility(prev, columnId, nextVisible);
        writeStoredRosterColumnPrefs(next);
        return next;
      });
    },
    [],
  );

  const toggleSort = useCallback((columnId: RosterColumnId) => {
    const nextSortKey = SORTABLE_COLUMNS[columnId];
    if (!nextSortKey) return;
    setSortKey((currentKey) => {
      if (currentKey === nextSortKey) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
        return currentKey;
      }
      setSortDir(columnId === "name" || columnId === "status" ? "asc" : "desc");
      return nextSortKey;
    });
  }, []);

  const ashedMembersUrl = ashedUrlForPath("/members");
  const tableColSpan =
    visibleColumns.length + (editMode ? 1 : 0);
  const selectedCount = selectedIds.size;
  const bulkDisabled = selectedCount === 0 || applying;

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
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
          {commanderData.seasonKey ? (
            <p className="mt-1 text-xs text-[#8b949e]">
              {tCommanders("seasonLine", { season: commanderData.seasonKey })}
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <RosterColumnVisibilityMenu
            visibility={columnVisibility}
            onToggle={toggleColumn}
          />
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

      <RosterSquadSummaryStrip summary={commanderData.summaryBySquad} />

      <div className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
        </div>
        <RosterCommanderFilterBar
          filterSquad={filterSquad}
          filterHqLink={filterHqLink}
          filterMinThp={filterMinThp}
          includeUnreported={includeUnreported}
          onFilterSquadChange={setFilterSquad}
          onFilterHqLinkChange={setFilterHqLink}
          onFilterMinThpChange={setFilterMinThp}
          onIncludeUnreportedChange={setIncludeUnreported}
        />
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

      <div className="min-w-0 overflow-x-auto rounded-xl border border-[#30363d]">
        <table className="w-full min-w-0 text-left text-sm">
          <thead className="border-b border-[#30363d] bg-[#161b22] text-xs uppercase tracking-wide text-[#8b949e]">
            <tr>
              {editMode ? (
                <th className="hidden w-10 px-2 py-3 md:table-cell" aria-hidden />
              ) : null}
              <th className="px-3 py-3 font-medium md:hidden sm:px-4">
                {t("colName")}
              </th>
              {visibleColumns.map((columnId) => {
                const sortable = SORTABLE_COLUMNS[columnId];
                const active = sortable != null && sortKey === sortable;
                return (
                  <th
                    key={columnId}
                    className={`hidden px-4 py-3 font-medium md:table-cell ${
                      sortable ? "cursor-pointer select-none" : ""
                    } ${
                      columnId === "allianceRank" || columnId === "status"
                        ? "text-center"
                        : ""
                    }`}
                    onClick={
                      sortable ? () => toggleSort(columnId) : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {rosterColumnHeaderLabel(columnId, t, tCommanders)}
                      {active ? (sortDir === "asc" ? " ↑" : " ↓") : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rosterRows.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan + 1}
                  className="px-3 py-8 text-center text-[#8b949e] sm:px-4"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : (
              rosterRows.map((row) => {
                const canEditRow =
                  commanderData.canEdit ||
                  commanderData.canSelfReportMemberIds.includes(
                    row.ashedMemberId,
                  );
                return (
                  <RosterMemberRow
                    key={row.ashedMemberId}
                    row={row}
                    columnVisibility={columnVisibility}
                    editMode={editMode}
                    selected={selectedIds.has(row.ashedMemberId)}
                    onToggleSelect={() => toggleSelected(row.ashedMemberId)}
                    showSquadEditColumn={showSquadEditColumn}
                    squadEdit={
                      showSquadEditColumn
                        ? {
                            row,
                            canEditRow,
                            pendingSquad: pendingSquad[row.ashedMemberId],
                            isSaving: savingSquad[row.ashedMemberId] ?? false,
                            saveError: saveError[row.ashedMemberId],
                            onPendingSquadChange: (value) =>
                              setPendingSquad((prev) => ({
                                ...prev,
                                [row.ashedMemberId]: value,
                              })),
                            onSave: () => void saveSquad(row.ashedMemberId),
                          }
                        : null
                    }
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {commanderData.canEdit ? (
        <RosterTeamBuilderSection rows={commanderData.rows} />
      ) : null}
    </div>
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
      commanderInitial={props.commanderInitial}
      canEditRanks={props.canEditRanks}
      canImportMembers={props.canImportMembers}
      canRefreshFromAshed={props.canRefreshFromAshed}
      canUploadRosterVideo={props.canUploadRosterVideo}
    />
  );
}
