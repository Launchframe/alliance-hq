"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import {
  ADMIN_COMMANDERS_PAGE_SIZE_DEFAULT,
  buildAdminCommandersSearchParams,
  type AdminCommandersQueryParams,
} from "@/lib/admin/admin-commanders-query.shared";

type AllianceOption = {
  id: string;
  name: string;
  slug: string;
  tag: string | null;
};

type CommanderListRow = {
  ashedMemberId: string;
  currentName: string;
  status: string;
  allianceRank: number | null;
  allianceId: string;
  allianceName: string;
  allianceTag: string | null;
  allianceSlug: string;
  hqUserEmail: string | null;
  hqUserDisplayName: string | null;
  discordUsername: string | null;
};

type CommanderDetail = CommanderListRow & {
  previousNames: string[];
  heroPowerM: number | null;
  memberLevel: number | null;
  hqUserId: string | null;
  discordUserId: string | null;
  tenureHistory: Array<{
    allianceId: string;
    allianceTag: string | null;
    allianceName: string | null;
    ashedMemberId: string;
    joinedAt: string;
    leftAt: string | null;
  }>;
};

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = ADMIN_COMMANDERS_PAGE_SIZE_DEFAULT;

function allianceLabel(row: {
  allianceName: string;
  allianceSlug: string;
  allianceTag: string | null;
}): string {
  const tag = row.allianceTag?.trim();
  return tag ? `${tag} (${row.allianceSlug})` : row.allianceSlug;
}

export function AdminCommandersConsole() {
  const t = useTranslations("admin.commandersPage");
  const [alliances, setAlliances] = useState<AllianceOption[]>([]);
  const [commanders, setCommanders] = useState<CommanderListRow[]>([]);
  const [selected, setSelected] = useState<CommanderDetail | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState<string | undefined>();
  const [allianceFilter, setAllianceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQ(searchInput.trim() || undefined);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const listQueryParams = useMemo(
    (): AdminCommandersQueryParams => ({
      q,
      page,
      limit: PAGE_SIZE,
      allianceId: allianceFilter || undefined,
      status: statusFilter || undefined,
    }),
    [allianceFilter, page, q, statusFilter],
  );

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const qs = buildAdminCommandersSearchParams(listQueryParams);
      const res = await fetch(`/api/admin/commanders?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        commanders: CommanderListRow[];
        total: number;
        alliances: AllianceOption[];
      };
      setCommanders(data.commanders);
      setTotal(data.total);
      setAlliances(data.alliances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
      setCommanders([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [listQueryParams, t]);

  const loadDetail = useCallback(
    async (row: CommanderListRow) => {
      setDetailLoading(true);
      try {
        const qs = buildAdminCommandersSearchParams({
          page: 1,
          limit: PAGE_SIZE,
          ashedMemberId: row.ashedMemberId,
          detailAllianceId: row.allianceId,
        });
        const res = await fetch(`/api/admin/commanders?${qs}`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { commander: CommanderDetail };
        setSelected(data.commander);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
        setSelected(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadList();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <div className="flex flex-wrap gap-3">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="min-w-[12rem] flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
            />
            <AppSelect
              value={allianceFilter}
              onChange={(value) => {
                setAllianceFilter(value);
                setPage(1);
              }}
              options={[
                { value: "", label: t("allAlliances") },
                ...alliances.map((alliance) => ({
                  value: alliance.id,
                  label: allianceLabel({
                    allianceName: alliance.name,
                    allianceSlug: alliance.slug,
                    allianceTag: alliance.tag,
                  }),
                })),
              ]}
            />
            <AppSelect
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              options={[
                { value: "", label: t("allStatuses") },
                { value: "active", label: t("statusActive") },
                { value: "former", label: t("statusFormer") },
              ]}
            />
          </div>

          {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#30363d] text-xs uppercase text-[#8b949e]">
                <tr>
                  <th className="px-2 py-2">{t("colName")}</th>
                  <th className="px-2 py-2">{t("colAlliance")}</th>
                  <th className="px-2 py-2">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-6 text-center text-[#8b949e]">
                      {t("loading")}
                    </td>
                  </tr>
                ) : commanders.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-6 text-center text-[#8b949e]">
                      {t("empty")}
                    </td>
                  </tr>
                ) : (
                  commanders.map((row) => (
                    <tr
                      key={`${row.allianceId}-${row.ashedMemberId}`}
                      className="cursor-pointer border-b border-[#30363d]/60 hover:bg-[#0d1117]"
                      onClick={() => void loadDetail(row)}
                    >
                      <td className="px-2 py-2 font-medium">{row.currentName}</td>
                      <td className="px-2 py-2 text-[#8b949e]">
                        {allianceLabel(row)}
                      </td>
                      <td className="px-2 py-2">{row.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-[#8b949e]">
            <span>{t("pagination", { total, page, totalPages })}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-[#30363d] px-2 py-1 disabled:opacity-40"
              >
                {t("prevPage")}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-[#30363d] px-2 py-1 disabled:opacity-40"
              >
                {t("nextPage")}
              </button>
            </div>
          </div>
        </section>

        <aside className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#8b949e]">
            {t("detailTitle")}
          </h2>
          {detailLoading ? (
            <p className="mt-4 text-sm text-[#8b949e]">{t("loading")}</p>
          ) : !selected ? (
            <p className="mt-4 text-sm text-[#8b949e]">{t("selectRow")}</p>
          ) : (
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[#6e7681]">{t("colName")}</dt>
                <dd>{selected.currentName}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#6e7681]">{t("colAlliance")}</dt>
                <dd>{allianceLabel(selected)}</dd>
              </div>
              {selected.hqUserEmail ? (
                <div>
                  <dt className="text-xs text-[#6e7681]">{t("hqUser")}</dt>
                  <dd>{selected.hqUserDisplayName ?? selected.hqUserEmail}</dd>
                </div>
              ) : null}
              {selected.discordUsername ? (
                <div>
                  <dt className="text-xs text-[#6e7681]">{t("discord")}</dt>
                  <dd>{selected.discordUsername}</dd>
                </div>
              ) : null}
              {selected.tenureHistory.length > 0 ? (
                <div>
                  <dt className="text-xs text-[#6e7681]">{t("tenure")}</dt>
                  <dd className="mt-1 space-y-1">
                    {selected.tenureHistory.map((row) => (
                      <p key={`${row.allianceId}-${row.joinedAt}`}>
                        {row.allianceTag ?? row.allianceName ?? row.allianceId}
                      </p>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}
