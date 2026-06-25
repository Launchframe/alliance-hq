"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { AllianceSetupGuidePanel } from "@/components/settings/AllianceSetupGuidePanel";
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

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/alliance/setup-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AllianceSetupStatusPayload | null) => {
        if (!cancelled) setRemote(data);
      })
      .catch(() => {
        if (!cancelled) setRemote(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
