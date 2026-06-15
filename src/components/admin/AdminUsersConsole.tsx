"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";

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
  roleId: string;
  roleName: string;
  source: string;
  status: string;
};

type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformMaintainer: boolean;
  createdAt: string;
  memberships: Membership[];
};

type DirectoryResponse = {
  users: AdminUser[];
  roles: RoleOption[];
  alliances: AllianceOption[];
};

export function AdminUsersConsole() {
  const t = useTranslations("admin.usersPage");
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newAllianceId, setNewAllianceId] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [membershipRoles, setMembershipRoles] = useState<Record<string, string>>(
    {},
  );
  const [platformMaintainer, setPlatformMaintainerFlag] = useState(false);

  const loadDirectory = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return (await res.json()) as DirectoryResponse;
  }, []);

  const selectUser = (user: AdminUser) => {
    setSelectedUserId(user.id);
    setPlatformMaintainerFlag(user.isPlatformMaintainer);
    setMembershipRoles(
      Object.fromEntries(
        user.memberships.map((membership) => [membership.id, membership.roleId]),
      ),
    );
    setNewAllianceId("");
    setNewRoleId(directory?.roles[0]?.id ?? "");
    setMessage(null);
    setError(null);
  };

  useEffect(() => {
    void (async () => {
      try {
        const data = await loadDirectory();
        setDirectory(data);
        if (data.users[0]) {
          selectUser(data.users[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [loadDirectory, t]);

  const selectedUser =
    directory?.users.find((user) => user.id === selectedUserId) ?? null;

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
      const refreshed = await loadDirectory();
      setDirectory(refreshed);
      const updated = refreshed.users.find((row) => row.id === selectedUser.id);
      if (updated) {
        selectUser(updated);
      }
      setMessage(t("saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (error && !directory) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (!directory) {
    return <p className="text-sm text-[#8b949e]">{t("loading")}</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="overflow-hidden rounded-xl border border-[#30363d]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#161b22] text-[#8b949e]">
            <tr>
              <th className="px-4 py-2">{t("table.email")}</th>
              <th className="px-4 py-2">{t("table.roles")}</th>
            </tr>
          </thead>
          <tbody>
            {directory.users.map((user) => (
              <tr
                key={user.id}
                className={`cursor-pointer border-t border-[#30363d] ${
                  selectedUserId === user.id ? "bg-[#1f3d5c]/40" : ""
                }`}
                onClick={() => selectUser(user)}
              >
                <td className="px-4 py-2">
                  <div>{user.email}</div>
                  {user.displayName ? (
                    <div className="text-xs text-[#8b949e]">{user.displayName}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-xs text-[#8b949e]">
                  {user.isPlatformMaintainer ? (
                    <span className="mr-2 rounded bg-[#238636]/20 px-1.5 py-0.5 text-[#3fb950]">
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
      </div>

      <div className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        {!selectedUser ? (
          <p className="text-sm text-[#8b949e]">{t("selectUser")}</p>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-medium">{selectedUser.email}</h2>
              <p className="mt-1 text-sm text-[#8b949e]">{t("editorHint")}</p>
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
              className="rounded-lg border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {t("savePlatform")}
            </button>

            <div>
              <h3 className="font-medium">{t("membershipsTitle")}</h3>
              {selectedUser.memberships.length === 0 ? (
                <p className="mt-2 text-sm text-[#8b949e]">{t("noMemberships")}</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {selectedUser.memberships.map((membership) => (
                    <div
                      key={membership.id}
                      className="flex flex-wrap items-end gap-3 rounded-lg border border-[#30363d] p-3"
                    >
                      <div className="min-w-40 flex-1">
                        <p className="font-medium">{membership.allianceName}</p>
                        <p className="text-xs text-[#8b949e]">
                          {membership.allianceSlug} · {membership.source}
                        </p>
                      </div>
                      <label className="block min-w-0 text-sm">
                        <span className="mb-1 block text-xs text-[#8b949e]">
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
                          options={directory.roles.map((role) => ({
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
                        className="rounded-lg border border-[#238636] bg-[#238636] px-3 py-2 text-sm text-white disabled:opacity-50"
                      >
                        {t("saveRole")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[#30363d] pt-4">
              <h3 className="font-medium">{t("assignTitle")}</h3>
              <p className="mt-1 text-sm text-[#8b949e]">{t("assignHint")}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="block min-w-0 text-sm sm:min-w-40">
                  <span className="mb-1 block text-xs text-[#8b949e]">
                    {t("allianceLabel")}
                  </span>
                  <AppSelect
                    value={newAllianceId}
                    onChange={setNewAllianceId}
                    placeholder={t("chooseAlliance")}
                    aria-label={t("allianceLabel")}
                    options={directory.alliances.map((alliance) => ({
                      value: alliance.id,
                      label: `${alliance.slug} — ${alliance.name}`,
                    }))}
                  />
                </label>
                <label className="block min-w-0 text-sm sm:min-w-32">
                  <span className="mb-1 block text-xs text-[#8b949e]">
                    {t("roleLabel")}
                  </span>
                  <AppSelect
                    value={newRoleId}
                    onChange={setNewRoleId}
                    aria-label={t("roleLabel")}
                    options={directory.roles.map((role) => ({
                      value: role.id,
                      label: role.name,
                    }))}
                  />
                </label>
                <button
                  type="button"
                  disabled={saving || !newAllianceId || !newRoleId}
                  onClick={() =>
                    void patchUser({
                      assignMembership: {
                        allianceId: newAllianceId,
                        roleId: newRoleId,
                      },
                    })
                  }
                  className="self-end rounded-lg border border-[#238636] bg-[#238636] px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("assignRole")}
                </button>
              </div>
            </div>
          </>
        )}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}
      </div>
    </div>
  );
}
