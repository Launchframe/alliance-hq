"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import type { TeamMember } from "@/lib/rbac/sync-ashed-roles";

type Props = {
  initialTeam: TeamMember[];
  canRefreshFromAshed?: boolean;
  canRevokeOfficers?: boolean;
  currentHqUserId?: string | null;
};

function CommanderOwnershipCell({
  commanderName,
  notLinkedLabel,
}: {
  commanderName: string | null;
  notLinkedLabel: string;
}) {
  if (commanderName) {
    return <span className="font-medium text-hq-fg">{commanderName}</span>;
  }

  return <span className="text-hq-fg-subtle">{notLinkedLabel}</span>;
}

export function SettingsTeamClient({
  initialTeam,
  canRefreshFromAshed = false,
  canRevokeOfficers = false,
  currentHqUserId = null,
}: Props) {
  const t = useTranslations("team");
  const [team, setTeam] = useState(initialTeam);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<TeamMember | null>(null);
  const [revoking, setRevoking] = useState(false);

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

  async function confirmRevoke() {
    if (!pendingRevoke) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/settings/team/memberships/${pendingRevoke.membershipId}/role`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleName: "member" }),
        },
      );
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        setError(data.error ?? t("revokeOfficerFailed"));
        return;
      }
      setTeam((current) =>
        current.map((member) =>
          member.membershipId === pendingRevoke.membershipId
            ? { ...member, roleName: "member", source: "manual" }
            : member,
        ),
      );
      setPendingRevoke(null);
    } finally {
      setRevoking(false);
    }
  }

  function canShowRevoke(member: TeamMember): boolean {
    return (
      canRevokeOfficers &&
      member.roleName === "officer" &&
      member.hqUserId !== currentHqUserId
    );
  }

  return (
    <>
      {canRefreshFromAshed ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void refreshFromAshed()}
            disabled={refreshing}
            className="w-full rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50 sm:w-auto"
          >
            {refreshing ? t("refreshing") : t("refreshFromAshed")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      <ResponsiveRecordViews
        isEmpty={team.length === 0}
        emptyMessage={t("empty")}
        mobileCards={team.map((member) => (
          <RecordDetailCard key={member.membershipId}>
            <RecordDetailField label={t("table.user")}>
              <div className="space-y-1">
                <div className="wrap-break-word">
                  {member.displayName ?? member.email}
                </div>
                {member.displayName ? (
                  <div className="text-sm font-normal text-hq-fg-muted">
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
            {canShowRevoke(member) ? (
              <button
                type="button"
                className="mt-2 text-sm text-hq-danger hover:underline"
                onClick={() => setPendingRevoke(member)}
              >
                {t("revokeOfficer")}
              </button>
            ) : null}
          </RecordDetailCard>
        ))}
        desktopTable={
          <div className="overflow-hidden rounded-xl border border-hq-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-hq-surface text-hq-fg-muted">
                <tr>
                  <th className="px-4 py-3">{t("table.user")}</th>
                  <th className="px-4 py-3">{t("table.commander")}</th>
                  <th className="px-4 py-3">{t("table.role")}</th>
                  <th className="px-4 py-3">{t("table.source")}</th>
                  {canRevokeOfficers ? (
                    <th className="px-4 py-3">{t("table.actions")}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {team.map((member) => (
                  <tr
                    key={member.membershipId}
                    className="border-t border-hq-border"
                  >
                    <td className="px-4 py-3">
                      <div>{member.displayName ?? member.email}</div>
                      {member.displayName ? (
                        <div className="text-xs text-hq-fg-muted">
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
                    {canRevokeOfficers ? (
                      <td className="px-4 py-3">
                        {canShowRevoke(member) ? (
                          <button
                            type="button"
                            className="text-hq-danger hover:underline"
                            onClick={() => setPendingRevoke(member)}
                          >
                            {t("revokeOfficer")}
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title={t("revokeOfficerConfirmTitle")}
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-hq-fg-muted">
            {t("revokeOfficerConfirmBody")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-hq-border px-3 py-2 text-sm text-hq-fg"
              onClick={() => setPendingRevoke(null)}
              disabled={revoking}
            >
              {t("revokeOfficerCancel")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-hq-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void confirmRevoke()}
              disabled={revoking}
            >
              {revoking ? t("revokeOfficerWorking") : t("revokeOfficerConfirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
