"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { CredentialSharePanel } from "@/components/settings/CredentialSharePanel";
import { SettingsTeamClient } from "@/components/SettingsTeamClient";
import { TeamInvitePanel } from "@/components/settings/TeamInvitePanel";
import { TeamRoleNudgesPanel } from "@/components/settings/TeamRoleNudgesPanel";
import type {
  OpenRoleNudge,
  RoleHistoryItem,
} from "@/components/settings/TeamRoleNudgesPanel";
import { VideoProcessorsPanel } from "@/components/settings/VideoProcessorsPanel";
import type { SystemRoleName } from "@/lib/rbac/constants";
import type { TeamMember } from "@/lib/rbac/sync-ashed-roles";
import {
  resolveTeamSettingsTab,
  type TeamSettingsTab,
} from "@/lib/settings/team-settings-tabs.shared";
import type { VideoProcessorEligibilityMode } from "@/lib/video/processor-slots.shared";

type Candidate = {
  hqUserId: string;
  email: string;
  displayName: string | null;
  subtitle: string | null;
  viaCredentialShareId?: string | null;
};

type Processor = {
  id: string;
  hqUserId: string;
  email: string;
  displayName: string | null;
  viaShareOwnerLabel?: string | null;
};

type Props = {
  canManageInvites: boolean;
  isAllianceAdmin: boolean;
  assignableInviteRoles: SystemRoleName[];
  allianceName: string;
  videoProcessors: Processor[];
  videoProcessorCandidates: Candidate[];
  videoProcessorEligibilityMode: VideoProcessorEligibilityMode;
  maxVideoProcessors: number;
  canManageCredentialShares: boolean;
  canRevokeOfficers: boolean;
  currentHqUserId: string | null;
  initialTeam: TeamMember[];
  canRefreshFromAshed: boolean;
  ashedNote: string | null;
  canViewRoleNudges: boolean;
  roleNudgesOpen: OpenRoleNudge[];
  roleNudgesHistory: RoleHistoryItem[];
};

function SettingsTeamTabsInner(props: Props) {
  const {
    canManageInvites,
    isAllianceAdmin,
    assignableInviteRoles,
    allianceName,
    videoProcessors,
    videoProcessorCandidates,
    videoProcessorEligibilityMode,
    maxVideoProcessors,
    canManageCredentialShares,
    canRevokeOfficers,
    currentHqUserId,
    initialTeam,
    canRefreshFromAshed,
    ashedNote,
    canViewRoleNudges,
    roleNudgesOpen,
    roleNudgesHistory,
  } = props;
  const t = useTranslations("team");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = resolveTeamSettingsTab(searchParams.get("tab"), {
    canManageInvites,
    isAllianceAdmin,
    hasInviteWizard: searchParams.has("inviteWizard"),
  });

  const [team, setTeam] = useState(initialTeam);
  const [nudgesOpen, setNudgesOpen] = useState(roleNudgesOpen);
  const [nudgesHistory, setNudgesHistory] = useState(roleNudgesHistory);

  const reloadRoleNudges = useCallback(async (): Promise<boolean> => {
    if (!canViewRoleNudges) return true;
    try {
      const res = await fetch("/api/settings/team/role-nudges");
      if (!res.ok) return false;
      const data = (await res.json()) as {
        open: OpenRoleNudge[];
        history: RoleHistoryItem[];
      };
      setNudgesOpen(data.open);
      setNudgesHistory(data.history);
      return true;
    } catch {
      return false;
    }
  }, [canViewRoleNudges]);

  const reloadTeam = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/team");
      if (!res.ok) return;
      const data = (await res.json()) as { team: TeamMember[] };
      setTeam(data.team);
    } catch {
      // Keep the current list; the next refresh or navigation reloads it.
    }
  }, []);

  const setTab = useCallback(
    (tab: TeamSettingsTab) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", tab);
      if (tab !== "invites") {
        next.delete("inviteWizard");
        next.delete("commander");
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const tabs: Array<{ id: TeamSettingsTab; label: string; show: boolean }> = [
    {
      id: "invites",
      label: t("tabs.invites"),
      show: canManageInvites,
    },
    {
      id: "processors",
      label: t("tabs.processors"),
      show: isAllianceAdmin,
    },
    {
      id: "credential-shares",
      label: t("tabs.credentialShares"),
      show: true,
    },
    {
      id: "members",
      label: t("tabs.members"),
      show: true,
    },
  ];

  const visibleTabs = tabs.filter((tab) => tab.show);

  return (
    <div className="space-y-6">
      <TeamRoleNudgesPanel
        open={nudgesOpen}
        history={nudgesHistory}
        onReload={reloadRoleNudges}
        onRoleChanged={() => void reloadTeam()}
      />

      <div
        className="inline-flex max-w-full flex-wrap rounded-lg border border-hq-border p-0.5 text-sm"
        role="tablist"
        aria-label={t("tabs.label")}
      >
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`team-settings-tab-${tab.id}`}
            onClick={() => setTab(tab.id)}
            className={
              activeTab === tab.id
                ? "rounded-md bg-hq-accent/15 px-3 py-1.5 text-hq-accent"
                : "rounded-md px-3 py-1.5 text-hq-fg-muted"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "invites" && canManageInvites ? (
        <TeamInvitePanel
          assignableRoles={assignableInviteRoles}
          allianceName={allianceName}
        />
      ) : null}

      {activeTab === "processors" && isAllianceAdmin ? (
        <VideoProcessorsPanel
          initialProcessors={videoProcessors}
          initialCandidates={videoProcessorCandidates}
          eligibilityMode={videoProcessorEligibilityMode}
          max={maxVideoProcessors}
        />
      ) : null}

      {activeTab === "credential-shares" ? (
        <CredentialSharePanel
          canManage={canManageCredentialShares}
          currentHqUserId={currentHqUserId}
        />
      ) : null}

      {activeTab === "members" ? (
        <>
          <SettingsTeamClient
            team={team}
            onTeamChange={setTeam}
            onRolesChanged={() => void reloadRoleNudges()}
            canRefreshFromAshed={canRefreshFromAshed}
            canRevokeOfficers={canRevokeOfficers}
            currentHqUserId={currentHqUserId}
          />
          {ashedNote ? (
            <p className="text-xs text-hq-fg-subtle">{ashedNote}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function SettingsTeamTabs(props: Props) {
  const t = useTranslations("team");
  return (
    <Suspense
      fallback={<p className="text-sm text-hq-fg-muted">{t("tabs.loading")}</p>}
    >
      <SettingsTeamTabsInner {...props} />
    </Suspense>
  );
}
