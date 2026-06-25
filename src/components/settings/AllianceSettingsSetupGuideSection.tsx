"use client";

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AllianceSetupGuidePanel } from "@/components/settings/AllianceSetupGuidePanel";
import { Link } from "@/i18n/navigation";
import type { AllianceSetupStatusPayload } from "@/lib/alliance-setup-guide-status-api";
import type { AllianceSetupGuideTaskId } from "@/lib/alliance-setup-guide-status.shared";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

export function AllianceSettingsSetupGuideSection({
  initial,
}: {
  initial: AllianceSetupStatusPayload | null;
}) {
  const t = useTranslations("allianceSetupGuide");
  const [remote, setRemote] = useState(initial);

  async function patchPrefs(body: {
    setupGuideDismissed?: boolean;
    setupGuideShowOnDashboard?: boolean;
  }) {
    const res = await fetch("/api/alliance/setup-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setRemote((await res.json()) as AllianceSetupStatusPayload);
    }
  }

  function handleTaskAction(id: AllianceSetupGuideTaskId) {
    switch (id) {
      case "connect_ashed":
        window.location.href = "/connect";
        break;
      case "roster_hardening":
      case "roster_populated":
        window.location.href = "/members";
        break;
      case "game_server":
        window.location.href = "/settings";
        break;
      case "owner_commander_link":
        window.location.href = "/onboard";
        break;
      case "team_invites":
        window.location.href = "/settings/team";
        break;
      case "discord_guild":
        window.location.href = "/guides/discord-train";
        break;
      default:
        break;
    }
  }

  if (!remote || !remote.viewerIsOfficer) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 min-w-0 w-full max-w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#58a6ff]/20">
          <Compass className="h-5 w-5 text-[#58a6ff]" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{t("sectionTitle")}</h2>
      </div>

      <div className="flex items-start justify-between gap-3 mb-4 min-w-0">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground block">
            {t("showOnDashboardLabel")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("showOnDashboardHint")}
          </span>
        </div>
        <input
          type="checkbox"
          checked={remote.setupGuideShowOnDashboard}
          onChange={(event) =>
            void patchPrefs({
              setupGuideShowOnDashboard: event.target.checked,
              ...(event.target.checked ? { setupGuideDismissed: false } : {}),
            })
          }
          aria-label={t("showOnDashboardLabel")}
          className="shrink-0 mt-0.5 h-4 w-4 rounded border-[#30363d] bg-[#0d1117] accent-[#58a6ff]"
        />
      </div>

      <AllianceSetupGuidePanel
        tasks={remote.tasks}
        completedCount={remote.completedCount}
        totalCount={remote.totalCount}
        allComplete={remote.allComplete}
        variant="settings"
        onTaskAction={handleTaskAction}
      />

      <p className="mt-4 text-xs text-muted-foreground">
        {t("rosterVideoHint")}{" "}
        <Link
          href={buildVideoUploadHref(MEMBER_ROSTER_VIDEO_SCORE_TARGET)}
          className="text-[#58a6ff] hover:underline"
        >
          {t("rosterVideoCta")}
        </Link>
      </p>
    </section>
  );
}
