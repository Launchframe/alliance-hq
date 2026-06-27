"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { CommanderIndexPayload, CommanderIndexRow } from "@/lib/commanders/index.shared";
import {
  MAIN_SQUAD_TYPES,
  MAIN_SQUAD_LABEL_KEYS,
  type MainSquadType,
} from "@/lib/commanders/main-squad.shared";
import {
  buildCommanderTeams,
  type CommanderTeamRow,
} from "@/lib/commanders/team-builder.shared";
import { MAX_TAKEDOWN_TEAMS } from "@/lib/vr/constants";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

type SortKey = "rank" | "name" | "thp" | "squad" | "vr";
type SortDir = "asc" | "desc";

type Props = {
  initial: CommanderIndexPayload;
};

function thpDisplay(value: number): string {
  if (value <= 0) return "—";
  return value.toLocaleString();
}

function rankDisplay(rank: number | null): string {
  return rank != null ? `R${rank}` : "—";
}

function vrDisplay(vr: number | null): string {
  return vr != null ? vr.toLocaleString() : "—";
}

export function CommandersIndexView({ initial }: Props) {
  const t = useTranslations("commandersIndex");

  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state
  const [filterSquad, setFilterSquad] = useState<MainSquadType | "">("");
  const [filterMinThp, setFilterMinThp] = useState("");
  const [includeUnreported, setIncludeUnreported] = useState(true);

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>("thp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Inline squad save state per row
  const [pendingSquad, setPendingSquad] = useState<Record<string, MainSquadType | "">>({});
  const [savingSquad, setSavingSquad] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});

  // Team builder state
  const [teamCount, setTeamCount] = useState(1);
  const [teamSquadFilter, setTeamSquadFilter] = useState<MainSquadType | "">("");
  const [teamIncludeUnreported, setTeamIncludeUnreported] = useState(true);
  const [showTeams, setShowTeams] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/commanders/index");
      const body = (await res.json()) as CommanderIndexPayload & { error?: string };
      if (!res.ok) {
        setLoadError((body as { error?: string }).error ?? t("loadFailed"));
        return;
      }
      setData(body);
      setPendingSquad({});
      setSaveError({});
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  const saveSquad = useCallback(
    async (row: CommanderIndexRow) => {
      const squad = pendingSquad[row.ashedMemberId] ?? row.mainSquad ?? "";
      if (!squad) return;

      const isOwner = data.canSelfReportMemberIds.includes(row.ashedMemberId);
      const method = isOwner && !data.canEdit ? "POST" : "PATCH";

      setSavingSquad((prev) => ({ ...prev, [row.ashedMemberId]: true }));
      setSaveError((prev) => ({ ...prev, [row.ashedMemberId]: "" }));
      try {
        const res = await fetch(`/api/members/${row.ashedMemberId}/main-squad`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mainSquad: squad }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) {
          setSaveError((prev) => ({
            ...prev,
            [row.ashedMemberId]: body.error ?? t("saveFailed"),
          }));
          return;
        }
        // Update local data optimistically
        setData((prev) => ({
          ...prev,
          rows: prev.rows.map((r) =>
            r.ashedMemberId === row.ashedMemberId
              ? {
                  ...r,
                  mainSquad: squad as MainSquadType,
                  mainSquadSource: data.canEdit ? "officer_override" : "self_report",
                }
              : r,
          ),
        }));
        setPendingSquad((prev) => {
          const next = { ...prev };
          delete next[row.ashedMemberId];
          return next;
        });
      } catch (e) {
        setSaveError((prev) => ({
          ...prev,
          [row.ashedMemberId]: e instanceof Error ? e.message : t("saveFailed"),
        }));
      } finally {
        setSavingSquad((prev) => ({ ...prev, [row.ashedMemberId]: false }));
      }
    },
    [data.canEdit, data.canSelfReportMemberIds, pendingSquad, t],
  );

  // Filtering
  const minThpNum = filterMinThp.trim() ? Number.parseInt(filterMinThp.trim(), 10) : 0;
  const filtered = data.rows.filter((row) => {
    if (filterSquad && row.mainSquad !== filterSquad) return false;
    if (!includeUnreported && row.mainSquad == null) return false;
    if (minThpNum > 0 && row.totalHeroPower < minThpNum) return false;
    return true;
  });

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "rank") {
      cmp = (a.allianceRank ?? 99) - (b.allianceRank ?? 99);
    } else if (sortKey === "name") {
      cmp = a.memberName.localeCompare(b.memberName);
    } else if (sortKey === "thp") {
      cmp = a.totalHeroPower - b.totalHeroPower;
    } else if (sortKey === "squad") {
      const squadOrder: Record<string, number> = { aircraft: 0, tank: 1, missile: 2 };
      cmp = (squadOrder[a.mainSquad ?? ""] ?? 3) - (squadOrder[b.mainSquad ?? ""] ?? 3);
    } else if (sortKey === "vr") {
      cmp = (a.highestBaseVr ?? -1) - (b.highestBaseVr ?? -1);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortTh({
    colKey,
    children,
  }: {
    colKey: SortKey;
    children: React.ReactNode;
  }) {
    const active = sortKey === colKey;
    return (
      <th
        className="cursor-pointer select-none px-4 py-3"
        onClick={() => toggleSort(colKey)}
      >
        <span className="flex items-center gap-1">
          {children}
          {active ? (sortDir === "asc" ? " ↑" : " ↓") : null}
        </span>
      </th>
    );
  }

  // Team builder
  const teamRows: CommanderTeamRow[] = data.rows.map((r) => ({
    ashedMemberId: r.ashedMemberId,
    memberName: r.memberName,
    totalHeroPower: r.totalHeroPower,
    mainSquad: r.mainSquad,
    mainSquadSource: r.mainSquadSource,
    allianceRank: r.allianceRank,
    highestBaseVr: r.highestBaseVr,
  }));

  const teamsResult = showTeams
    ? buildCommanderTeams(teamRows, teamCount, {
        mainSquad: teamSquadFilter || undefined,
        includeUnreported: teamIncludeUnreported,
      })
    : null;

  const summary = data.summaryBySquad;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 p-4 sm:p-6">
      {/* Header */}
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
        <p className="mt-2 text-sm text-[#8b949e]">{t("subtitle")}</p>
        {data.seasonKey ? (
          <p className="mt-1 text-xs text-[#8b949e]">
            {t("seasonLine", { season: data.seasonKey })}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="mt-3 rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-50"
        >
          {refreshing ? t("refreshing") : t("refresh")}
        </button>
      </header>

      {loadError ? <p className="text-sm text-[#f85149]">{loadError}</p> : null}

      {/* Summary strip */}
      <div className="flex flex-wrap gap-3">
        {(["aircraft", "tank", "missile"] as const).map((squad) => (
          <div
            key={squad}
            className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm"
          >
            <span className="font-medium text-[#e6edf3]">
              {t(`squad.${MAIN_SQUAD_LABEL_KEYS[squad]}`)}
            </span>
            <span className="text-[#8b949e]">
              {summary[squad].count} · {t("avgThp", { thp: summary[squad].avgThp.toLocaleString() })}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm">
          <span className="font-medium text-[#8b949e]">{t("unreported")}</span>
          <span className="text-[#8b949e]">
            {summary.unreported.count} · {t("avgThp", { thp: summary.unreported.avgThp.toLocaleString() })}
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
          {t("filterSquad")}
          <select
            value={filterSquad}
            onChange={(e) => setFilterSquad(e.target.value as MainSquadType | "")}
            className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
          >
            <option value="">{t("filterSquadAll")}</option>
            {MAIN_SQUAD_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`squad.${MAIN_SQUAD_LABEL_KEYS[s]}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
          {t("filterMinThp")}
          <input
            value={filterMinThp}
            onChange={(e) => setFilterMinThp(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className="w-32 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-[#8b949e]">
          <input
            type="checkbox"
            checked={includeUnreported}
            onChange={(e) => setIncludeUnreported(e.target.checked)}
            className="h-4 w-4 rounded border-[#30363d] bg-[#161b22]"
          />
          {t("filterIncludeUnreported")}
        </label>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-[#30363d] bg-[#0D0D0D]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[#30363d] text-xs uppercase tracking-wide text-[#8b949e]">
            <tr>
              <SortTh colKey="rank">{t("colRank")}</SortTh>
              <SortTh colKey="name">{t("colCommander")}</SortTh>
              <SortTh colKey="thp">{t("colThp")}</SortTh>
              <SortTh colKey="squad">{t("colSquad")}</SortTh>
              <th className="px-4 py-3">{t("colInGameRank")}</th>
              <SortTh colKey="vr">{t("colVr")}</SortTh>
              {(data.canEdit || data.canSelfReportMemberIds.length > 0) ? (
                <th className="px-4 py-3">{t("colSquadEdit")}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const canEditRow =
                data.canEdit || data.canSelfReportMemberIds.includes(row.ashedMemberId);
              const currentPending = pendingSquad[row.ashedMemberId];
              const isSaving = savingSquad[row.ashedMemberId] ?? false;
              const rowErr = saveError[row.ashedMemberId];

              return (
                <tr
                  key={row.ashedMemberId}
                  className="border-b border-[#21262d] last:border-0"
                >
                  <td className="px-4 py-3 text-[#8b949e]">{index + 1}</td>
                  <td className="px-4 py-3 font-medium text-[#e6edf3]">
                    <Link
                      href={`/members/${row.ashedMemberId}`}
                      className="hover:underline"
                    >
                      {row.memberName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-[#e6edf3]">
                    {thpDisplay(row.totalHeroPower)}
                  </td>
                  <td className="px-4 py-3 text-[#8b949e]">
                    {row.mainSquad
                      ? t(`squad.${MAIN_SQUAD_LABEL_KEYS[row.mainSquad]}`)
                      : <span className="text-[#484f58]">{t("unreportedShort")}</span>}
                    {row.mainSquadSource === "officer_override" ? (
                      <span className="ml-1 text-xs text-[#d29922]">
                        {t("sourceOfficer")}
                      </span>
                    ) : row.mainSquadSource === "self_report" ? (
                      <span className="ml-1 text-xs text-[#3fb950]">
                        {t("sourceSelf")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[#8b949e]">
                    {rankDisplay(row.allianceRank)}
                    {row.allianceRankTitle ? (
                      <span className="ml-1 text-xs text-[#484f58]">
                        {row.allianceRankTitle}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-[#8b949e]">
                    {vrDisplay(row.highestBaseVr)}
                  </td>
                  {(data.canEdit || data.canSelfReportMemberIds.length > 0) ? (
                    <td className="px-4 py-3">
                      {canEditRow ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            preventDefaultFormSubmit(e);
                            void saveSquad(row);
                          }}
                        >
                          <select
                            value={currentPending ?? row.mainSquad ?? ""}
                            onChange={(e) =>
                              setPendingSquad((prev) => ({
                                ...prev,
                                [row.ashedMemberId]: e.target.value as MainSquadType | "",
                              }))
                            }
                            disabled={isSaving}
                            className="rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3] disabled:opacity-50"
                          >
                            <option value="">{t("squadNone")}</option>
                            {MAIN_SQUAD_TYPES.map((s) => (
                              <option key={s} value={s}>
                                {t(`squad.${MAIN_SQUAD_LABEL_KEYS[s]}`)}
                              </option>
                            ))}
                          </select>
                          {(currentPending != null && currentPending !== (row.mainSquad ?? "")) ? (
                            <button
                              type="submit"
                              disabled={isSaving}
                              className="rounded-md bg-[#238636] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              {isSaving ? t("saving") : t("save")}
                            </button>
                          ) : null}
                          {rowErr ? (
                            <span className="text-xs text-[#f85149]">{rowErr}</span>
                          ) : null}
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={data.canEdit || data.canSelfReportMemberIds.length > 0 ? 7 : 6}
                  className="px-4 py-8 text-center text-[#8b949e]"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Team builder — only for officers/owners */}
      {data.canEdit ? (
        <section className="rounded-2xl border border-[#30363d] bg-[#0D0D0D] p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-[#e6edf3]">
            {t("teamBuilder.title")}
          </h2>
          <p className="mt-1 text-sm text-[#8b949e]">{t("teamBuilder.subtitle")}</p>

          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              preventDefaultFormSubmit(e);
              setShowTeams(true);
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
              {t("teamBuilder.teamCount")}
              <input
                type="number"
                min={1}
                max={MAX_TAKEDOWN_TEAMS}
                value={teamCount}
                onChange={(e) => setTeamCount(Math.max(1, Math.min(MAX_TAKEDOWN_TEAMS, Number.parseInt(e.target.value, 10) || 1)))}
                inputMode="numeric"
                className="w-20 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
              {t("teamBuilder.squadFilter")}
              <select
                value={teamSquadFilter}
                onChange={(e) => setTeamSquadFilter(e.target.value as MainSquadType | "")}
                className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
              >
                <option value="">{t("filterSquadAll")}</option>
                {MAIN_SQUAD_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`squad.${MAIN_SQUAD_LABEL_KEYS[s]}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-[#8b949e]">
              <input
                type="checkbox"
                checked={teamIncludeUnreported}
                onChange={(e) => setTeamIncludeUnreported(e.target.checked)}
                className="h-4 w-4 rounded border-[#30363d] bg-[#161b22]"
              />
              {t("filterIncludeUnreported")}
            </label>

            <button
              type="submit"
              className="rounded-lg bg-[#1f6feb] px-4 py-2 text-sm font-medium text-white"
            >
              {t("teamBuilder.build")}
            </button>
          </form>

          {teamsResult != null ? (
            <div className="mt-6">
              {teamsResult.ok ? (
                <div className="flex flex-wrap gap-4">
                  {teamsResult.teams.map((team) => (
                    <div
                      key={team.teamIndex}
                      className="min-w-[220px] flex-1 rounded-xl border border-[#30363d] bg-[#161b22] p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#e6edf3]">
                          {t("teamBuilder.teamLabel", { index: team.teamIndex })}
                        </span>
                        <span className="font-mono text-xs text-[#8b949e]">
                          {team.teamTotalHeroPower.toLocaleString()} THP
                        </span>
                      </div>
                      <ul className="space-y-1">
                        <li className="flex items-center gap-2 text-sm">
                          <span className="rounded bg-[#1f6feb33] px-1.5 py-0.5 text-xs font-medium text-[#58a6ff]">
                            {t("teamBuilder.lead")}
                          </span>
                          <span className="truncate text-[#e6edf3]">{team.lead.memberName}</span>
                          <span className="ml-auto font-mono text-xs text-[#8b949e]">
                            {team.lead.totalHeroPower.toLocaleString()}
                          </span>
                        </li>
                        {team.fillers.map((filler) => (
                          <li
                            key={filler.ashedMemberId}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="w-[3.5rem] shrink-0" />
                            <span className="truncate text-[#c9d1d9]">{filler.memberName}</span>
                            <span className="ml-auto font-mono text-xs text-[#8b949e]">
                              {filler.totalHeroPower.toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#f85149]">
                  {t("teamBuilder.insufficient", {
                    needed: teamsResult.needed,
                    have: teamsResult.have,
                  })}
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
