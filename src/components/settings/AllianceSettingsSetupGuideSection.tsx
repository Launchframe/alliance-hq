"use client";

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { AllianceSetupGuidePanel } from "@/components/settings/AllianceSetupGuidePanel";
import { Link, usePathname } from "@/i18n/navigation";
import { ALLIANCE_SETUP_STATUS_REFRESH_EVENT } from "@/lib/alliance-setup-guide-refresh.shared";
import { allianceSetupGuideTaskHref } from "@/lib/alliance-setup-guide-nav";
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
  const pathname = usePathname();
  const [remote, setRemote] = useState(initial);

  const loadStatus = useCallback(() => {
    void fetch("/api/alliance/setup-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AllianceSetupStatusPayload | null) => {
        if (data) setRemote(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function handleRefresh() {
      loadStatus();
    }
    window.addEventListener(ALLIANCE_SETUP_STATUS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(
        ALLIANCE_SETUP_STATUS_REFRESH_EVENT,
        handleRefresh,
      );
    };
  }, [loadStatus]);

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
    const href = allianceSetupGuideTaskHref(id, pathname);
    if (href) {
      window.location.href = href;
    }
  }

  if (!remote || !remote.viewerIsOfficer) {
    return null;
  }

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5 min-w-0 w-full max-w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-hq-accent/20">
          <Compass className="h-5 w-5 text-hq-accent" />
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
          className="shrink-0 mt-0.5 h-4 w-4 rounded border-hq-border bg-hq-canvas accent-hq-accent"
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
          className="text-hq-accent hover:underline"
        >
          {t("rosterVideoCta")}
        </Link>
      </p>
    </section>
  );
}
