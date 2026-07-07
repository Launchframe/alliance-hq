"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import {
  ADMIN_USERS_PAGE_SIZE_DEFAULT,
  buildAdminUsersSearchParams,
  type AdminUsersQueryParams,
} from "@/lib/rbac/admin-users-query.shared";

type RoleOption = {
  id: string;
  name: string;
  description: string | null;
};

type AllianceOption = {
  id: string;
  name: string;
  slug: string;
};

type Membership = {
  id: string;
  hqUserId: string;
  allianceId: string;
  allianceName: string;
  allianceSlug: string;
  allianceTag: string | null;
  roleId: string;
  roleName: string;
  source: string;
  status: string;
};

type MemberLink = {
  id: string;
  hqUserId: string;
  allianceId: string;
  allianceName: string;
  allianceSlug: string;
  allianceTag: string | null;
  ashedMemberId: string;
  memberDisplayName: string | null;
  linkedAt: string;
};

type AdminUserListRow = {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformMaintainer: boolean;
  createdAt: string;
  linkedDeviceCount: number;
  memberships: Array<{
    allianceSlug: string;
    allianceTag: string | null;
    roleName: string;
  }>;
};

type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformMaintainer: boolean;
  createdAt: string;
  linkedDeviceCount: number;
  memberships: Membership[];
  memberLinks: MemberLink[];
};

type UsersListResponse = {
  users: AdminUserListRow[];
  total: number;
  page: number;
  pageSize: number;
  roles: RoleOption[];
  alliances: AllianceOption[];
};

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = ADMIN_USERS_PAGE_SIZE_DEFAULT;

function allianceLabel(row: {
  allianceName?: string;
  allianceSlug: string;
  allianceTag: string | null;
}): string {
  const tag = row.allianceTag?.trim();
  if (tag) {
    return `${tag} (${row.allianceSlug})`;
  }
  return row.allianceSlug;
}

function AdminIdLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="font-mono text-xs leading-relaxed text-hq-fg-muted">
      <span className="text-[#c9d1d9]">{label}</span>{" "}
      <span className="break-all text-hq-fg">{value}</span>
    </p>
  );
}

export function AdminUsersConsole() {
  const t = useTranslations("admin.usersPage");
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [alliances, setAlliances] = useState<AllianceOption[]>([]);
  const [listUsers, setListUsers] = useState<AdminUserListRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState<string | undefined>();
  const [allianceFilter, setAllianceFilter] = useState("");
  const [platformMaintainersOnly, setPlatformMaintainersOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newAllianceId, setNewAllianceId] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [membershipRoles, setMembershipRoles] = useState<Record<string, string>>(
    {},
  );
  const [platformMaintainer, setPlatformMaintainerFlag] = useState(false);

  const listQueryParams = useMemo(
    (): AdminUsersQueryParams => ({
      q,
      page,
      limit: PAGE_SIZE,
      allianceId: allianceFilter || undefined,
      platformMaintainersOnly,
    }),
    [allianceFilter, page, platformMaintainersOnly, q],
  );

  const loadUserList = useCallback(async () => {
    setListLoading(true);
    try {
      const qs = buildAdminUsersSearchParams(listQueryParams);
      const res = await fetch(`/api/admin/users?${qs}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as UsersListResponse;
      setListUsers(data.users);
      setTotal(data.total);
      setRoles(data.roles);
      setAlliances(data.alliances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
      setListUsers([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [listQueryParams, t]);

  const loadUserDetail = useCallback(
    async (hqUserId: string) => {
      setDetailLoading(true);
      try {
        const qs = buildAdminUsersSearchParams({
          page: 1,
          limit: PAGE_SIZE,
          hqUserId,
          platformMaintainersOnly: false,
        });
        const res = await fetch(`/api/admin/users?${qs}`);
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as { user: AdminUser };
        applySelectedUser(data.user);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
        setSelectedUser(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [t],
  );

  function applySelectedUser(user: AdminUser) {
    setSelectedUserId(user.id);
    setSelectedUser(user);
    setPlatformMaintainerFlag(user.isPlatformMaintainer);
    setMembershipRoles(
      Object.fromEntries(
        user.memberships.map((membership) => [membership.id, membership.roleId]),
      ),
    );
    setNewAllianceId("");
    setNewRoleId(roles[0]?.id ?? "");
    setMessage(null);
    setError(null);
  }

  function selectListUser(user: AdminUserListRow) {
    void loadUserDetail(user.id);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQ(searchInput.trim() || undefined);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUserList();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUserList]);

  const assignRoleId = newRoleId || roles[0]?.id || "";

  async function patchUser(body: Record<string, unknown>) {
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hqUserId: selectedUser.id, ...body }),
      });
      const data = (await res.json()) as { error?: string; user?: AdminUser };
      if (!res.ok) {
        throw new Error(data.error ?? t("saveFailed"));
      }
      if (data.user) {
        applySelectedUser(data.user);
      }
      await loadUserList();
      setMessage(t("saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, total);
  const canGoPrev = page > 1;
  const canGoNext = page * PAGE_SIZE < total;

  if (error && listUsers.length === 0 && !listLoading && roles.length === 0) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4">
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("search.label")}</span>
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.label")}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
            />
          </label>

          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("filters.alliance")}</span>
            <AppSelect
              value={allianceFilter}
              onChange={(next) => {
                setAllianceFilter(next);
                setPage(1);
              }}
              searchable
              placeholder={t("filters.allianceAll")}
              aria-label={t("filters.alliance")}
              options={[
                { value: "", label: t("filters.allianceAll") },
                ...alliances.map((alliance) => ({
                  value: alliance.id,
                  label: `${alliance.slug} — ${alliance.name}`,
                })),
              ]}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-[#c9d1d9]">
            <input
              type="checkbox"
              checked={platformMaintainersOnly}
              onChange={(event) => {
                setPlatformMaintainersOnly(event.target.checked);
                setPage(1);
              }}
            />
            {t("filters.platformMaintainersOnly")}
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-hq-fg-muted">
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
              disabled={!canGoPrev || listLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-hq-border px-3 py-1.5 text-[#c9d1d9] disabled:opacity-40"
            >
              {t("pagination.prev")}
            </button>
            <button
              type="button"
              disabled={!canGoNext || listLoading}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-lg border border-hq-border px-3 py-1.5 text-[#c9d1d9] disabled:opacity-40"
            >
              {t("pagination.next")}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-hq-border">
          {listLoading && listUsers.length === 0 ? (
            <p className="p-4 text-sm text-hq-fg-muted">{t("loading")}</p>
          ) : listUsers.length === 0 ? (
            <p className="p-4 text-sm text-hq-fg-muted">{t("empty")}</p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="bg-hq-surface text-hq-fg-muted">
                <tr>
                  <th className="px-4 py-2">{t("table.email")}</th>
                  <th className="px-4 py-2">{t("table.linkedDevices")}</th>
                  <th className="px-4 py-2">{t("table.roles")}</th>
                </tr>
              </thead>
              <tbody>
                {listUsers.map((user) => (
                  <tr
                    key={user.id}
                    className={`cursor-pointer border-t border-hq-border transition-colors hover:bg-hq-surface ${
                      selectedUserId === user.id ? "bg-hq-selected/40" : ""
                    }`}
                    onClick={() => selectListUser(user)}
                  >
                    <td className="px-4 py-2">
                      <div>{user.email}</div>
                      {user.displayName ? (
                        <div className="text-xs text-hq-fg-muted">
                          {user.displayName}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-hq-fg-muted">
                      {user.linkedDeviceCount}
                    </td>
                    <td className="px-4 py-2 text-xs text-hq-fg-muted">
                      {user.isPlatformMaintainer ? (
                        <span className="mr-2 rounded bg-hq-success/20 px-1.5 py-0.5 text-hq-green">
                          platform
                        </span>
                      ) : null}
                      {user.memberships.length === 0
                        ? t("noMemberships")
                        : user.memberships
                            .map(
                              (membership) =>
                                `${membership.allianceSlug}:${membership.roleName}`,
                            )
                            .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5">
        {detailLoading ? (
          <p className="text-sm text-hq-fg-muted">{t("loadingDetail")}</p>
        ) : !selectedUser ? (
          <p className="text-sm text-hq-fg-muted">{t("selectUser")}</p>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-medium">{selectedUser.email}</h2>
              <p className="mt-1 text-sm text-hq-fg-muted">{t("editorHint")}</p>
              <div className="mt-3 space-y-1 rounded-lg border border-hq-border bg-hq-canvas p-3">
                <AdminIdLine label={t("ids.hqUserId")} value={selectedUser.id} />
              </div>
              <p className="mt-2 text-sm text-hq-fg-muted">
                {t("linkedDevicesSummary", {
                  count: selectedUser.linkedDeviceCount,
                })}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={platformMaintainer}
                onChange={(e) => setPlatformMaintainerFlag(e.target.checked)}
              />
              {t("platformMaintainer")}
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void patchUser({ isPlatformMaintainer: platformMaintainer })
              }
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {t("savePlatform")}
            </button>

            <div>
              <h3 className="font-medium">{t("membershipsTitle")}</h3>
              {selectedUser.memberships.length === 0 ? (
                <p className="mt-2 text-sm text-hq-fg-muted">{t("noMemberships")}</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {selectedUser.memberships.map((membership) => (
                    <div
                      key={membership.id}
                      className="flex flex-wrap items-end gap-3 rounded-lg border border-hq-border p-3"
                    >
                      <div className="min-w-40 flex-1">
                        <p className="font-medium">{membership.allianceName}</p>
                        <p className="text-xs text-hq-fg-muted">
                          {allianceLabel(membership)} · {membership.source}
                        </p>
                        <div className="mt-2 space-y-1">
                          <AdminIdLine
                            label={t("ids.membershipId")}
                            value={membership.id}
                          />
                          <AdminIdLine
                            label={t("ids.allianceId")}
                            value={membership.allianceId}
                          />
                        </div>
                      </div>
                      <label className="block min-w-0 text-sm">
                        <span className="mb-1 block text-xs text-hq-fg-muted">
                          {t("roleLabel")}
                        </span>
                        <AppSelect
                          value={
                            membershipRoles[membership.id] ?? membership.roleId
                          }
                          onChange={(next) =>
                            setMembershipRoles((current) => ({
                              ...current,
                              [membership.id]: next,
                            }))
                          }
                          aria-label={t("roleLabel")}
                          options={roles.map((role) => ({
                            value: role.id,
                            label: role.name,
                          }))}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void patchUser({
                            updateMembership: {
                              membershipId: membership.id,
                              roleId:
                                membershipRoles[membership.id] ?? membership.roleId,
                            },
                          })
                        }
                        className="rounded-lg border border-hq-success bg-hq-success px-3 py-2 text-sm text-white disabled:opacity-50"
                      >
                        {t("saveRole")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-medium">{t("memberLinksTitle")}</h3>
              {selectedUser.memberLinks.length === 0 ? (
                <p className="mt-2 text-sm text-hq-fg-muted">{t("noMemberLinks")}</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {selectedUser.memberLinks.map((link) => (
                    <div
                      key={link.id}
                      className="space-y-2 rounded-lg border border-hq-border p-3"
                    >
                      <p className="font-medium">
                        {link.memberDisplayName ?? t("memberLinkUnnamed")}
                      </p>
                      <p className="text-xs text-hq-fg-muted">
                        {allianceLabel(link)} · {link.allianceName}
                      </p>
                      <div className="space-y-1">
                        <AdminIdLine label={t("ids.memberLinkId")} value={link.id} />
                        <AdminIdLine
                          label={t("ids.allianceId")}
                          value={link.allianceId}
                        />
                        <AdminIdLine
                          label={t("ids.ashedMemberId")}
                          value={link.ashedMemberId}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-hq-border pt-4">
              <h3 className="font-medium">{t("assignTitle")}</h3>
              <p className="mt-1 text-sm text-hq-fg-muted">{t("assignHint")}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="block min-w-0 text-sm sm:min-w-40">
                  <span className="mb-1 block text-xs text-hq-fg-muted">
                    {t("allianceLabel")}
                  </span>
                  <AppSelect
                    value={newAllianceId}
                    onChange={setNewAllianceId}
                    searchable
                    placeholder={t("chooseAlliance")}
                    aria-label={t("allianceLabel")}
                    options={alliances.map((alliance) => ({
                      value: alliance.id,
                      label: `${alliance.slug} — ${alliance.name}`,
                    }))}
                  />
                </label>
                <label className="block min-w-0 text-sm sm:min-w-32">
                  <span className="mb-1 block text-xs text-hq-fg-muted">
                    {t("roleLabel")}
                  </span>
                  <AppSelect
                    value={newRoleId || roles[0]?.id || ""}
                    onChange={setNewRoleId}
                    aria-label={t("roleLabel")}
                    options={roles.map((role) => ({
                      value: role.id,
                      label: role.name,
                    }))}
                  />
                </label>
                <button
                  type="button"
                  disabled={saving || !newAllianceId || !assignRoleId}
                  onClick={() =>
                    void patchUser({
                      assignMembership: {
                        allianceId: newAllianceId,
                        roleId: assignRoleId,
                      },
                    })
                  }
                  className="self-end rounded-lg border border-hq-success bg-hq-success px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("assignRole")}
                </button>
              </div>
            </div>
          </>
        )}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {message ? <p className="text-sm text-hq-green">{message}</p> : null}
      </div>
    </div>
  );
}
