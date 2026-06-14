"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type HqUser = {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformMaintainer: number;
  createdAt: string;
};

export default function AdminUsersPage() {
  const t = useTranslations("admin");
  const [users, setUsers] = useState<HqUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ users: HqUser[] }>;
      })
      .then((data) => setUsers(data.users))
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("loadFailed")),
      );
  }, [t]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#30363d]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#161b22] text-[#8b949e]">
          <tr>
            <th className="px-4 py-2">{t("table.email")}</th>
            <th className="px-4 py-2">{t("table.displayName")}</th>
            <th className="px-4 py-2">{t("table.platform")}</th>
            <th className="px-4 py-2">{t("table.time")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-[#30363d]">
              <td className="px-4 py-2">{user.email}</td>
              <td className="px-4 py-2">{user.displayName ?? "—"}</td>
              <td className="px-4 py-2">
                {user.isPlatformMaintainer === 1 ? t("yes") : t("no")}
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                {new Date(user.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
