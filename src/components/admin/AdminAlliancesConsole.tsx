"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { AdminNativeAlliancePanel } from "@/components/admin/AdminNativeAlliancePanel";
import type { NativeAllianceCreateDraft } from "@/components/admin/AdminNativeAlliancePanel";
import { AllianceSessionSwitcher } from "@/components/alliance/AllianceSessionSwitcher";
import { Link } from "@/i18n/navigation";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { AppSelect } from "@/components/ui/AppSelect";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import {
  buildAdminAlliancesSearchParams,
  type AdminAlliancesOperatingMode,
  type AdminAlliancesOrder,
  type AdminAlliancesQueryParams,
  type AdminAlliancesSort,
} from "@/lib/admin/admin-alliances-query.shared";

type Alliance = {
  id: string;
  slug: string;
  name: string;
  ashedAllianceId: string | null;
  operatingMode: string;
  gameServerNumber: number | null;
  ownerEmail: string | null;
  collaborators: string[];
  rolesSyncedAt: string | null;
  memberCount: number;
};

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;
const INVITE_OPTIONS_LIMIT = 500;

function isNativeAlliance(alliance: Alliance): boolean {
  return alliance.operatingMode === "native";
}

export function AdminAlliancesConsole() {
  const t = useTranslations("admin.alliancesPage");
  const tNative = useTranslations("admin.nativeAlliance");
  const tSetupRequests = useTranslations("admin.allianceSetupRequests");
  const searchParams = useSearchParams();
  const initialCreateDraft = useMemo((): NativeAllianceCreateDraft | null => {
    const setupName = searchParams.get("setupName")?.trim();
    const setupTag = searchParams.get("setupTag")?.trim();
    const setupServer = searchParams.get("setupServer")?.trim();
    const setupOwnerEmail = searchParams.get("setupOwnerEmail")?.trim();
    if (!setupName && !setupTag && !setupServer && !setupOwnerEmail) {
      return null;
    }
    return {
      name: setupName || undefined,
      tag: setupTag || undefined,
      gameServerNumber: setupServer || undefined,
      ownerEmail: setupOwnerEmail || undefined,
    };
  }, [searchParams]);
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [inviteAllianceOptions, setInviteAllianceOptions] = useState<
    Array<{ id: string; slug: string; name: string }>
  >([]);
  const [inviteTargetAllianceId, setInviteTargetAllianceId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState<string | undefined>();
  const [operatingMode, setOperatingMode] =
    useState<AdminAlliancesOperatingMode>("all");
  const [sort, setSort] = useState<AdminAlliancesSort>("name");
  const [order, setOrder] = useState<AdminAlliancesOrder>("asc");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverDrafts, setServerDrafts] = useState<Record<string, string>>({});
  const [savingServerId, setSavingServerId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const queryParams = useMemo(
    (): AdminAlliancesQueryParams => ({
      q,
      operatingMode,
      sort,
      order,
      limit: PAGE_SIZE,
      offset,
    }),
    [offset, operatingMode, order, q, sort],
  );

  const effectiveInviteTargetAllianceId = inviteAllianceOptions.some(
    (row) => row.id === inviteTargetAllianceId,
  )
    ? inviteTargetAllianceId
    : "";

  const loadInviteAllianceOptions = useCallback(async () => {
    try {
      const qs = buildAdminAlliancesSearchParams({
        operatingMode: "all",
        sort: "name",
        order: "asc",
        limit: INVITE_OPTIONS_LIMIT,
        offset: 0,
      });
      const res = await fetch(`/api/admin/alliances?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { alliances: Alliance[] };
      setInviteAllianceOptions(
        data.alliances.map((alliance) => ({
          id: alliance.id,
          slug: alliance.slug,
          name: alliance.name,
        })),
      );
    } catch {
      // Invite dropdown is optional if the list fetch fails
    }
  }, []);

  const loadAlliances = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildAdminAlliancesSearchParams(queryParams);
      const res = await fetch(`/api/admin/alliances?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        alliances: Alliance[];
        total: number;
        limit: number;
        offset: number;
      };
      setAlliances(data.alliances);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
      setAlliances([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [queryParams, t]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQ(searchInput.trim() || undefined);
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInviteAllianceOptions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadInviteAllianceOptions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAlliances();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAlliances]);

  function refreshAfterMutation() {
    void loadAlliances();
    void loadInviteAllianceOptions();
  }

  function selectInviteTarget(allianceId: string) {
    if (!inviteAllianceOptions.some((row) => row.id === allianceId)) {
      return;
    }
    setInviteTargetAllianceId(allianceId);
  }

  function serverDraftValue(alliance: Alliance): string {
    return (
      serverDrafts[alliance.id] ??
      (alliance.gameServerNumber != null
        ? String(alliance.gameServerNumber)
        : "")
    );
  }

  async function saveServerNumber(alliance: Alliance) {
    const draft = serverDraftValue(alliance).trim();
    const parsed = draft ? Number.parseInt(draft, 10) : null;
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setServerError(t("serverColumn.invalid"));
      return;
    }
    if (parsed === (alliance.gameServerNumber ?? null)) {
      return;
    }
    setSavingServerId(alliance.id);
    setServerError(null);
    try {
      const res = await fetch(
        `/api/admin/alliances/${encodeURIComponent(alliance.id)}/game-server`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameServerNumber: parsed }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? t("serverColumn.saveFailed"));
      }
      setServerDrafts((current) => {
        const next = { ...current };
        delete next[alliance.id];
        return next;
      });
      void loadAlliances();
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : t("serverColumn.saveFailed"),
      );
    } finally {
      setSavingServerId(null);
    }
  }

  function inviteRowClassName(alliance: Alliance): string {
    const base = "border-t border-[#30363d] align-top";
    const selected = alliance.id === effectiveInviteTargetAllianceId;
    return [
      base,
      "cursor-pointer transition-colors hover:bg-[#161b22]",
      selected ? "bg-[#1f3d5c]/25 ring-1 ring-inset ring-[#388bfd]/40" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function renderServerCell(alliance: Alliance) {
    const native = isNativeAlliance(alliance);
    if (!native) {
      return (
        <span className="text-sm text-[#8b949e]">
          {alliance.gameServerNumber ?? "—"}
        </span>
      );
    }
    const draft = serverDraftValue(alliance);
    const dirty = draft.trim() !== (alliance.gameServerNumber != null
      ? String(alliance.gameServerNumber)
      : "");
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.stopPropagation();
          preventDefaultFormSubmit(event);
          if (dirty && savingServerId !== alliance.id) {
            void saveServerNumber(alliance);
          }
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          placeholder={t("serverColumn.placeholder")}
          aria-label={t("serverColumn.inputLabel", { name: alliance.name })}
          enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
          onChange={(event) =>
            setServerDrafts((current) => ({
              ...current,
              [alliance.id]: event.target.value.replace(/\D/g, ""),
            }))
          }
          className="w-20 rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={!dirty || savingServerId === alliance.id}
          className="rounded-lg border border-[#238636] bg-[#238636]/10 px-2 py-1 text-xs text-[#3fb950] disabled:opacity-40"
        >
          {savingServerId === alliance.id
            ? t("serverColumn.saving")
            : t("serverColumn.save")}
        </button>
      </form>
    );
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const canGoPrev = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="space-y-8">
      <p className="text-sm">
        <Link
          href="/admin/alliance-setup-requests"
          className="text-[#58a6ff] hover:underline"
        >
          {tSetupRequests("navLink")}
        </Link>
      </p>
      <AdminNativeAlliancePanel
        nativeAlliances={inviteAllianceOptions}
        selectedAllianceId={effectiveInviteTargetAllianceId}
        onSelectAlliance={setInviteTargetAllianceId}
        onCreated={() => refreshAfterMutation()}
        initialCreateDraft={initialCreateDraft}
      />

      {effectiveInviteTargetAllianceId ? (
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <h3 className="text-sm font-medium text-[#e6edf3]">
            {t("sessionContext.title")}
          </h3>
          <p className="mt-1 text-sm text-[#8b949e]">
            {t("sessionContext.hint")}
          </p>
          <div className="mt-3 max-w-md">
            <AllianceSessionSwitcher
              stayOnCurrentPage
              switchTargetAllianceId={effectiveInviteTargetAllianceId}
              searchable
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {serverError ? (
          <p
            role="alert"
            className="rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 px-3 py-2 text-sm text-[#f85149]"
          >
            {serverError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <label className="min-w-0 flex-1 space-y-1 text-sm sm:min-w-[14rem]">
            <span className="text-[#8b949e]">{t("search.label")}</span>
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.label")}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            />
          </label>

          <label className="min-w-0 space-y-1 text-sm sm:min-w-[12rem]">
            <span className="text-[#8b949e]">{t("filters.operatingMode")}</span>
            <AppSelect
              value={operatingMode}
              onChange={(next) => {
                setOperatingMode(next as AdminAlliancesOperatingMode);
                setOffset(0);
              }}
              aria-label={t("filters.operatingMode")}
              options={[
                { value: "all", label: t("filters.operatingModeAll") },
                { value: "native", label: t("filters.operatingModeNative") },
                { value: "ashed", label: t("filters.operatingModeAshed") },
              ]}
            />
          </label>

          <label className="min-w-0 space-y-1 text-sm sm:min-w-[12rem]">
            <span className="text-[#8b949e]">{t("filters.sort")}</span>
            <AppSelect
              value={sort}
              onChange={(next) => {
                setSort(next as AdminAlliancesSort);
                setOffset(0);
              }}
              aria-label={t("filters.sort")}
              options={[
                { value: "name", label: t("filters.sortName") },
                { value: "memberCount", label: t("filters.sortMemberCount") },
                {
                  value: "rolesSyncedAt",
                  label: t("filters.sortRolesSyncedAt"),
                },
              ]}
            />
          </label>

          <label className="min-w-0 space-y-1 text-sm sm:min-w-[10rem]">
            <span className="text-[#8b949e]">{t("filters.order")}</span>
            <AppSelect
              value={order}
              onChange={(next) => {
                setOrder(next as AdminAlliancesOrder);
                setOffset(0);
              }}
              aria-label={t("filters.order")}
              options={[
                { value: "asc", label: t("filters.orderAsc") },
                { value: "desc", label: t("filters.orderDesc") },
              ]}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#8b949e]">
          <p>
            {total === 0
              ? t("pagination.empty")
              : t("pagination.showing", {
                  start: pageStart,
                  end: pageEnd,
                  total,
                })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canGoPrev || loading}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              className="rounded-lg border border-[#30363d] px-3 py-1.5 text-[#c9d1d9] disabled:opacity-40"
            >
              {t("pagination.prev")}
            </button>
            <button
              type="button"
              disabled={!canGoNext || loading}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              className="rounded-lg border border-[#30363d] px-3 py-1.5 text-[#c9d1d9] disabled:opacity-40"
            >
              {t("pagination.next")}
            </button>
          </div>
        </div>

        <ResponsiveRecordViews
          isEmpty={!loading && alliances.length === 0}
          emptyMessage={t("empty")}
          mobileCards={alliances.map((alliance) => {
            const native = isNativeAlliance(alliance);
            const selected = alliance.id === effectiveInviteTargetAllianceId;
            return (
              <RecordDetailCard
                key={alliance.id}
                selected={selected}
                onClick={() => selectInviteTarget(alliance.id)}
              >
                <RecordDetailField label={t("table.alliance")}>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{alliance.name}</span>
                      {native ? (
                        <span className="rounded bg-[#388bfd]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#58a6ff]">
                          {t("table.nativeBadge")}
                        </span>
                      ) : null}
                      {selected ? (
                        <span className="text-xs text-[#58a6ff]">
                          {tNative("selectedForInvite")}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm font-normal text-[#8b949e]">
                      {alliance.slug}
                      {alliance.ashedAllianceId
                        ? ` · ${alliance.ashedAllianceId}`
                        : ""}
                    </div>
                  </div>
                </RecordDetailField>
                <RecordDetailField label={t("table.server")}>
                  {renderServerCell(alliance)}
                </RecordDetailField>
                <RecordDetailField label={t("table.owner")}>
                  {alliance.ownerEmail ?? "—"}
                </RecordDetailField>
                <RecordDetailField label={t("table.collaborators")}>
                  <span className="wrap-break-word text-sm font-normal">
                    {alliance.collaborators.length
                      ? alliance.collaborators.join(", ")
                      : "—"}
                  </span>
                </RecordDetailField>
                <RecordDetailField label={t("table.members")}>
                  {alliance.memberCount}
                </RecordDetailField>
                <RecordDetailField label={t("table.synced")}>
                  {alliance.rolesSyncedAt ? (
                    <FormattedDateTime value={alliance.rolesSyncedAt} />
                  ) : (
                    "—"
                  )}
                </RecordDetailField>
              </RecordDetailCard>
            );
          })}
          desktopTable={
            <div className="overflow-x-auto rounded-xl border border-[#30363d]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#161b22] text-[#8b949e]">
                  <tr>
                    <th className="px-4 py-2">{t("table.alliance")}</th>
                    <th className="px-4 py-2">{t("table.server")}</th>
                    <th className="px-4 py-2">{t("table.owner")}</th>
                    <th className="px-4 py-2">{t("table.collaborators")}</th>
                    <th className="px-4 py-2">{t("table.members")}</th>
                    <th className="px-4 py-2">{t("table.synced")}</th>
                  </tr>
                </thead>
                <tbody>
                  {alliances.map((alliance) => {
                    const native = isNativeAlliance(alliance);
                    const selected =
                      alliance.id === effectiveInviteTargetAllianceId;
                    return (
                      <tr
                        key={alliance.id}
                        className={inviteRowClassName(alliance)}
                        onClick={() => selectInviteTarget(alliance.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectInviteTarget(alliance.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={tNative("selectAllianceRow", {
                          name: alliance.name,
                          slug: alliance.slug,
                        })}
                        aria-pressed={selected}
                      >
                        <td className="px-4 py-2">
                          <div className="font-medium">{alliance.name}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#8b949e]">
                            <span>
                              {alliance.slug}
                              {alliance.ashedAllianceId
                                ? ` · ${alliance.ashedAllianceId}`
                                : ""}
                            </span>
                            {native ? (
                              <span className="rounded bg-[#388bfd]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#58a6ff]">
                                {t("table.nativeBadge")}
                              </span>
                            ) : null}
                            {selected ? (
                              <span className="text-[#58a6ff]">
                                {tNative("selectedForInvite")}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          {renderServerCell(alliance)}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {alliance.ownerEmail ?? "—"}
                        </td>
                        <td className="max-w-xs px-4 py-2 text-xs text-[#8b949e]">
                          {alliance.collaborators.length
                            ? alliance.collaborators.join(", ")
                            : "—"}
                        </td>
                        <td className="px-4 py-2">{alliance.memberCount}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs text-[#8b949e]">
                          {alliance.rolesSyncedAt ? (
                            <FormattedDateTime
                              value={alliance.rolesSyncedAt}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
        />
      </div>
    </div>
  );
}
