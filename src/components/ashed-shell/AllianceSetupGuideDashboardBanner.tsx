"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { AllianceSetupGuidePanel } from "@/components/settings/AllianceSetupGuidePanel";
import { ALLIANCE_SETUP_STATUS_REFRESH_EVENT } from "@/lib/alliance-setup-guide-refresh.shared";
import { allianceSetupGuideTaskHref } from "@/lib/alliance-setup-guide-nav";
import type { AllianceSetupStatusPayload } from "@/lib/alliance-setup-guide-status-api";
import type { AllianceSetupGuideTaskId } from "@/lib/alliance-setup-guide-status.shared";

/**
 * Compact setup checklist shown on alliance home for officers who opted to keep
 * it on the dashboard. Server-authoritative: completion and prefs come from
 * /api/alliance/setup-status (same source as the Settings section).
 */
export function AllianceSetupGuideDashboardBanner() {
  const t = useTranslations("allianceSetupGuide");
  const [remote, setRemote] = useState<AllianceSetupStatusPayload | null>(null);

  const loadStatus = useCallback((isCancelled: () => boolean) => {
    void fetch("/api/alliance/setup-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AllianceSetupStatusPayload | null) => {
        if (!isCancelled()) setRemote(data);
      })
      .catch(() => {
        if (!isCancelled()) setRemote(null);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    loadStatus(isCancelled);

    function handleRefresh() {
      loadStatus(isCancelled);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadStatus(isCancelled);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(ALLIANCE_SETUP_STATUS_REFRESH_EVENT, handleRefresh);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(
        ALLIANCE_SETUP_STATUS_REFRESH_EVENT,
        handleRefresh,
      );
    };
  }, [loadStatus]);

  if (
    !remote ||
    !remote.viewerIsOfficer ||
    !remote.setupGuideShowOnDashboard ||
    remote.setupGuideDismissed ||
    remote.allComplete
  ) {
    return null;
  }

  function handleTaskAction(id: AllianceSetupGuideTaskId) {
    const href = allianceSetupGuideTaskHref(id);
    if (href) {
      window.location.href = href;
    }
  }

  async function dismiss() {
    // Optimistically hide; the pref persists so it stays hidden on reload.
    setRemote((prev) => (prev ? { ...prev, setupGuideDismissed: true } : prev));
    await fetch("/api/alliance/setup-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupGuideDismissed: true }),
    }).catch(() => undefined);
  }

  return (
    <div className="relative mb-4 min-w-0 w-full max-w-full">
      <button
        type="button"
        onClick={() => void dismiss()}
        aria-label={t("dismiss")}
        className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
      <AllianceSetupGuidePanel
        tasks={remote.tasks}
        completedCount={remote.completedCount}
        totalCount={remote.totalCount}
        allComplete={remote.allComplete}
        variant="dashboard"
        onTaskAction={handleTaskAction}
      />
    </div>
  );
}
