"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function isNativeAlliance(alliance: Alliance): boolean {
  return alliance.operatingMode === "native";
}

export function AdminAlliancesConsole() {
  const t = useTranslations("admin.alliancesPage");
  const tNative = useTranslations("admin.nativeAlliance");
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [inviteTargetAllianceId, setInviteTargetAllianceId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inviteAllianceOptions = useMemo(
    () =>
      alliances.map((alliance) => ({
        id: alliance.id,
        slug: alliance.slug,
        name: alliance.name,
      })),
    [alliances],
  );

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

  const effectiveInviteTargetAllianceId = inviteAllianceOptions.some(
    (row) => row.id === inviteTargetAllianceId,
  )
    ? inviteTargetAllianceId
    : "";

  function selectInviteTarget(allianceId: string) {
    if (!inviteAllianceOptions.some((row) => row.id === allianceId)) {
      return;
    }
    setInviteTargetAllianceId(allianceId);
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

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="space-y-8">
      <AdminNativeAlliancePanel
        nativeAlliances={inviteAllianceOptions}
        selectedAllianceId={effectiveInviteTargetAllianceId}
        onSelectAlliance={setInviteTargetAllianceId}
        onCreated={() => void loadAlliances()}
      />
      <ResponsiveRecordViews
        isEmpty={alliances.length === 0}
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
                  <th className="px-4 py-2">{t("table.owner")}</th>
                  <th className="px-4 py-2">{t("table.collaborators")}</th>
                  <th className="px-4 py-2">{t("table.members")}</th>
                  <th className="px-4 py-2">{t("table.synced")}</th>
                </tr>
              </thead>
              <tbody>
                {alliances.map((alliance) => {
                  const native = isNativeAlliance(alliance);
                  const selected = alliance.id === effectiveInviteTargetAllianceId;
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
                  );
                })}
              </tbody>
            </table>
          </div>
        }
      />
    </div>
  );
}
