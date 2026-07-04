"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";

import { usePathname } from "@/i18n/navigation";
import type { SessionAllianceOption } from "@/lib/alliance/types";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import {
  readAshedShellConnectDismissed,
  shouldShowAshedConnectNudge,
  subscribeAshedShellConnectDismissed,
} from "@/lib/connect/ashed-shell-prompts.shared";
import { AllianceSetupGuideDashboardBanner } from "@/components/ashed-shell/AllianceSetupGuideDashboardBanner";
import { OpsInboxBell } from "@/components/ashed-shell/OpsInboxBell";
import { ReminderInboxBell } from "@/components/ashed-shell/ReminderInboxBell";
import { AdminSequenceOverlay } from "@/components/hotkeys/AdminSequenceOverlay";
import { HotkeyCommandPalette } from "@/components/hotkeys/HotkeyCommandPalette";
import { HotkeyKeyboardButton } from "@/components/hotkeys/HotkeyKeyboardButton";
import { HotkeyProvider } from "@/components/hotkeys/HotkeyProvider";
import { ConnectAshedBanner } from "@/components/onboarding/ConnectAshedBanner";
import { FeedbackProvider } from "@/components/feedback";
import { SidebarNav } from "@/components/ashed-shell/SidebarNav";
import { ShellProfileMenu } from "@/components/ashed-shell/ShellProfileMenu";
import { DevQuickSwitch } from "@/components/dev/DevQuickSwitch";
import { findActiveNavGroupId } from "@/lib/nav/routes";
import { TokenExpiryBanner } from "@/components/TokenExpiryNotice";
import { ReleaseNoticeBanner } from "@/components/release-notes/ReleaseNoticeBanner";
import { ReleaseNotesProvider } from "@/components/release-notes/ReleaseNotesProvider";
import {
  VideoJobEventsProvider,
  VideoJobStatusBanners,
} from "@/components/video/VideoJobEventsProvider";

type Props = {
  sessionId: string;
  userLabel: string | null;
  displayName?: string | null;
  userEmail?: string | null;
  avatarUrl?: string | null;
  isConnected: boolean;
  hasAppAccess?: boolean;
  isNativeAlliance?: boolean;
  operatingMode?: "ashed" | "native" | null;
  canUseAshedEmbeds?: boolean;
  isAshedConnectAllowed?: boolean;
  ashed: AshedConnectionMeta | null;
  showAdminPortal?: boolean;
  showTeamAccess?: boolean;
  showVideoQueue?: boolean;
  showVideoProcessorsNav?: boolean;
  showAllianceSettings?: boolean;
  activeAllianceTag?: string | null;
  currentAllianceId?: string | null;
  membershipAlliances?: SessionAllianceOption[];
  isPlatformMaintainer?: boolean;
  sessionPermissions?: readonly string[];
  /** Dev/preview-only: render the test-matrix quick-switch panel. */
  devQuickSwitch?: boolean;
  children: React.ReactNode;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function AshedShell({
  sessionId,
  userLabel,
  displayName = null,
  userEmail = null,
  avatarUrl = null,
  isConnected,
  hasAppAccess = isConnected,
  isNativeAlliance = false,
  operatingMode = null,
  canUseAshedEmbeds = true,
  isAshedConnectAllowed = true,
  ashed,
  showAdminPortal = false,
  showTeamAccess = false,
  showVideoQueue = false,
  showVideoProcessorsNav = false,
  showAllianceSettings = false,
  activeAllianceTag = null,
  currentAllianceId = null,
  membershipAlliances = [],
  isPlatformMaintainer = false,
  sessionPermissions = [],
  devQuickSwitch = false,
  children,
}: Props) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [expandedGroupId, setExpandedGroupId] = React.useState<string | null>(
    null,
  );
  const ashedConnectDismissed = React.useSyncExternalStore(
    subscribeAshedShellConnectDismissed,
    readAshedShellConnectDismissed,
    () => false,
  );

  const showSignedInChrome =
    hasAppAccess && (isConnected || !canUseAshedEmbeds);
  // Officer setup checklist appears on alliance home only (Ashed dashboard /
  // native members), gated server-side by the show-on-dashboard preference.
  const showSetupGuideBanner =
    hasAppAccess && (pathname === "/dashboard" || pathname === "/members");
  const showConnectNudge = shouldShowAshedConnectNudge({
    hasAppAccess,
    isConnected,
    isAshedConnectAllowed,
    dismissed: ashedConnectDismissed,
  });

  const closeMobileNav = React.useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const openMobileNav = React.useCallback(() => {
    setExpandedGroupId(
      findActiveNavGroupId(pathname, {
        showAdminPortal,
        showTeamAccess,
        showAllianceSettings,
      }),
    );
    setMobileNavOpen(true);
  }, [pathname, showAdminPortal, showTeamAccess, showAllianceSettings]);

  const toggleGroup = React.useCallback((groupId: string) => {
    setExpandedGroupId((current) => (current === groupId ? null : groupId));
  }, []);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMobileNavOpen(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  React.useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  return (
    <VideoJobEventsProvider>
      <ReleaseNotesProvider sessionId={sessionId}>
        <FeedbackProvider>
          <HotkeyProvider
            sessionPermissions={sessionPermissions}
            isConnected={isConnected}
            operatingMode={operatingMode}
            showVideoQueue={showVideoQueue}
            onOpenMobileNav={openMobileNav}
          >
          <div className="flex min-h-screen min-h-[100dvh] overflow-x-clip bg-[#0d1117] text-[#e6edf3]">
          <div
            className={cn(
              "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ease-out lg:hidden",
              mobileNavOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0",
            )}
            aria-hidden={!mobileNavOpen}
            onClick={closeMobileNav}
          />

          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex h-screen max-h-[100dvh] w-full max-w-[min(100vw,20rem)] flex-col border-r border-[#30363d] bg-[#161b22] transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:z-auto lg:w-60 lg:max-w-none lg:shrink-0 lg:self-start lg:translate-x-0",
              mobileNavOpen
                ? "translate-x-0"
                : "-translate-x-full max-lg:pointer-events-none",
            )}
          >
            <SidebarNav
              showAdminPortal={showAdminPortal}
              showTeamAccess={showTeamAccess}
              showVideoQueue={showVideoQueue}
              showVideoProcessorsNav={showVideoProcessorsNav}
              showAllianceSettings={showAllianceSettings}
              activeAllianceTag={activeAllianceTag}
              operatingMode={operatingMode}
              canUseAshedEmbeds={canUseAshedEmbeds}
              currentAllianceId={currentAllianceId}
              membershipAlliances={membershipAlliances}
              isPlatformMaintainer={isPlatformMaintainer}
              sessionPermissions={sessionPermissions}
              mobileCollapsible
              expandedGroupId={expandedGroupId}
              onToggleGroup={toggleGroup}
              onNavigate={closeMobileNav}
              onClose={closeMobileNav}
            />
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex min-h-[3.25rem] shrink-0 items-center gap-3 border-b border-[#30363d] bg-[#161b22] px-4 py-2 md:px-6 md:py-3">
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3] transition-colors hover:bg-[#21262d] lg:hidden"
                onClick={openMobileNav}
                aria-label={t("openMenu")}
                aria-expanded={mobileNavOpen}
                aria-controls="hq-app-shell"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </button>

              <div className="min-w-0 flex-1 truncate text-sm text-[#8b949e]">
                {showSignedInChrome ? (
                  <span className="hidden sm:inline">
                    {isNativeAlliance
                      ? t("nativeSignedInAs", {
                          user: userLabel ?? t("defaultUser"),
                        })
                      : t("connectedAs", {
                          user: userLabel ?? t("defaultUser"),
                        })}
                  </span>
                ) : null}
                {hasAppAccess ? (
                  <span className="truncate sm:hidden">
                    {userLabel ?? t("defaultUser")}
                  </span>
                ) : null}
              </div>

              {hasAppAccess ? (
                <div className="flex shrink-0 items-center gap-2">
                  <HotkeyKeyboardButton />
                  {sessionPermissions.includes("inbox:read") ? (
                    <ReminderInboxBell />
                  ) : null}
                  {showAdminPortal ? <OpsInboxBell /> : null}
                  <ShellProfileMenu
                  userLabel={userLabel}
                  displayName={displayName}
                  userEmail={userEmail}
                  avatarUrl={avatarUrl}
                  showAdminPortal={showAdminPortal}
                  showConnectLink={showConnectNudge}
                  showMenu={Boolean(userEmail || userLabel || displayName)}
                />
                </div>
              ) : null}
            </header>

            <ReleaseNoticeBanner />
            <ConnectAshedBanner show={showConnectNudge} />
            {ashed ? <TokenExpiryBanner ashed={ashed} /> : null}
            <VideoJobStatusBanners />

            <main
              id="hq-app-shell"
              className="flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-6"
            >
              {showSetupGuideBanner ? (
                <AllianceSetupGuideDashboardBanner />
              ) : null}
              {children}
            </main>
          </div>
          </div>
          <HotkeyCommandPalette
            sessionPermissions={sessionPermissions}
            isConnected={isConnected}
            operatingMode={operatingMode}
            showVideoQueue={showVideoQueue}
          />
          <AdminSequenceOverlay />
          </HotkeyProvider>
          {devQuickSwitch ? <DevQuickSwitch /> : null}
        </FeedbackProvider>
      </ReleaseNotesProvider>
    </VideoJobEventsProvider>
  );
}
