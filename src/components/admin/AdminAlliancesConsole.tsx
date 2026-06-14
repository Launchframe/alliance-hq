"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Alliance = {
  id: string;
  slug: string;
  name: string;
  ashedAllianceId: string | null;
  ownerEmail: string | null;
  collaborators: string[];
  rolesSyncedAt: string | null;
  memberCount: number;
};

export function AdminAlliancesConsole() {
  const t = useTranslations("admin.alliancesPage");
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/alliances");
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { alliances: Alliance[] };
        setAlliances(data.alliances);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [t]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="overflow-x-auto rounded-xl border border-[#30363d]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#161b22] text-[#8b949e]">
          <tr>
            <th className="px-4 py-2">{t("table.alliance")}</th>
            <th className="px-4 py-2">{t("table.owner")}</th>
            <th className="px-4 py-2">{t("table.collaborators")}</th>
            <th className="px-4 py-2">{t("table.members")}</th>
            <th className="px-4 py-2">{t("table.synced")}</th>
          </tr>
        </thead>
        <tbody>
          {alliances.map((alliance) => (
            <tr key={alliance.id} className="border-t border-[#30363d] align-top">
              <td className="px-4 py-2">
                <div className="font-medium">{alliance.name}</div>
                <div className="text-xs text-[#8b949e]">
                  {alliance.slug}
                  {alliance.ashedAllianceId
                    ? ` · ${alliance.ashedAllianceId}`
                    : ""}
                </div>
              </td>
              <td className="px-4 py-2 text-xs">{alliance.ownerEmail ?? "—"}</td>
              <td className="max-w-xs px-4 py-2 text-xs text-[#8b949e]">
                {alliance.collaborators.length
                  ? alliance.collaborators.join(", ")
                  : "—"}
              </td>
              <td className="px-4 py-2">{alliance.memberCount}</td>
              <td className="px-4 py-2 whitespace-nowrap text-xs text-[#8b949e]">
                {alliance.rolesSyncedAt
                  ? new Date(alliance.rolesSyncedAt).toLocaleString()
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
