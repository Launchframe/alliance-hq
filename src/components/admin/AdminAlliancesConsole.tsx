"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AdminNativeAlliancePanel } from "@/components/admin/AdminNativeAlliancePanel";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";

type Alliance = {
  id: string;
  slug: string;
  name: string;
  ashedAllianceId: string | null;
  operatingMode: string;
  ownerEmail: string | null;
  collaborators: string[];
  rolesSyncedAt: string | null;
  memberCount: number;
};

export function AdminAlliancesConsole() {
  const t = useTranslations("admin.alliancesPage");
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadAlliances = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/alliances");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { alliances: Alliance[] };
      setAlliances(data.alliances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAlliances();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAlliances]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="space-y-8">
      <AdminNativeAlliancePanel onCreated={() => void loadAlliances()} />
      <ResponsiveRecordViews
      isEmpty={alliances.length === 0}
      emptyMessage={t("empty")}
      mobileCards={alliances.map((alliance) => (
        <RecordDetailCard key={alliance.id}>
          <RecordDetailField label={t("table.alliance")}>
            <div className="space-y-1">
              <div>{alliance.name}</div>
              <div className="text-sm font-normal text-[#8b949e]">
                {alliance.slug}
                {alliance.ashedAllianceId
                  ? ` · ${alliance.ashedAllianceId}`
                  : ""}
              </div>
            </div>
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
      ))}
      desktopTable={
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
                <tr
                  key={alliance.id}
                  className="border-t border-[#30363d] align-top"
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">{alliance.name}</div>
                    <div className="text-xs text-[#8b949e]">
                      {alliance.slug}
                      {alliance.ashedAllianceId
                        ? ` · ${alliance.ashedAllianceId}`
                        : ""}
                    </div>
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
                      <FormattedDateTime value={alliance.rolesSyncedAt} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
    </div>
  );
}
