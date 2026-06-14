"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { TeamMember } from "@/lib/rbac/sync-ashed-roles";

type Props = {
  initialTeam: TeamMember[];
};

export function SettingsTeamClient({ initialTeam }: Props) {
  const t = useTranslations("team");
  const [team, setTeam] = useState(initialTeam);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshFromAshed() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/team", { method: "POST" });
      if (!res.ok) {
        setError(t("refreshFailed"));
        return;
      }
      const data = (await res.json()) as { team: TeamMember[] };
      setTeam(data.team);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void refreshFromAshed()}
          disabled={refreshing}
          className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50"
        >
          {refreshing ? t("refreshing") : t("refreshFromAshed")}
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="overflow-hidden rounded-xl border border-[#30363d]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#161b22] text-[#8b949e]">
            <tr>
              <th className="px-4 py-3">{t("table.user")}</th>
              <th className="px-4 py-3">{t("table.role")}</th>
              <th className="px-4 py-3">{t("table.source")}</th>
            </tr>
          </thead>
          <tbody>
            {team.map((member) => (
              <tr key={member.email} className="border-t border-[#30363d]">
                <td className="px-4 py-3">
                  <div>{member.displayName ?? member.email}</div>
                  {member.displayName ? (
                    <div className="text-xs text-[#8b949e]">{member.email}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3 capitalize">{member.roleName}</td>
                <td className="px-4 py-3">{member.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
