"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import type { TeamMember } from "@/lib/rbac/sync-ashed-roles";

type Props = {
  initialTeam: TeamMember[];
  canRefreshFromAshed?: boolean;
};

function CommanderOwnershipCell({
  commanderName,
  notLinkedLabel,
}: {
  commanderName: string | null;
  notLinkedLabel: string;
}) {
  if (commanderName) {
    return <span className="font-medium text-[#e6edf3]">{commanderName}</span>;
  }

  return <span className="text-[#6e7681]">{notLinkedLabel}</span>;
}

export function SettingsTeamClient({
  initialTeam,
  canRefreshFromAshed = false,
}: Props) {
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
      {canRefreshFromAshed ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void refreshFromAshed()}
            disabled={refreshing}
            className="w-full rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 sm:w-auto"
          >
            {refreshing ? t("refreshing") : t("refreshFromAshed")}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <ResponsiveRecordViews
        isEmpty={team.length === 0}
        emptyMessage={t("empty")}
        mobileCards={team.map((member) => (
          <RecordDetailCard key={member.email}>
            <RecordDetailField label={t("table.user")}>
              <div className="space-y-1">
                <div className="wrap-break-word">
                  {member.displayName ?? member.email}
                </div>
                {member.displayName ? (
                  <div className="text-sm font-normal text-[#8b949e]">
                    {member.email}
                  </div>
                ) : null}
              </div>
            </RecordDetailField>
            <RecordDetailField label={t("table.commander")}>
              <CommanderOwnershipCell
                commanderName={member.commanderName}
                notLinkedLabel={t("table.commanderNotLinked")}
              />
            </RecordDetailField>
            <RecordDetailField label={t("table.role")}>
              <span className="capitalize">{member.roleName}</span>
            </RecordDetailField>
            <RecordDetailField label={t("table.source")}>
              {member.source}
            </RecordDetailField>
          </RecordDetailCard>
        ))}
        desktopTable={
          <div className="overflow-hidden rounded-xl border border-[#30363d]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#161b22] text-[#8b949e]">
                <tr>
                  <th className="px-4 py-3">{t("table.user")}</th>
                  <th className="px-4 py-3">{t("table.commander")}</th>
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
                        <div className="text-xs text-[#8b949e]">
                          {member.email}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <CommanderOwnershipCell
                        commanderName={member.commanderName}
                        notLinkedLabel={t("table.commanderNotLinked")}
                      />
                    </td>
                    <td className="px-4 py-3 capitalize">{member.roleName}</td>
                    <td className="px-4 py-3">{member.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />
    </>
  );
}
