"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import type { SessionAllianceOption } from "@/lib/alliance/types";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import { FeedbackProvider } from "@/components/feedback";
import { SidebarNav } from "@/components/ashed-shell/SidebarNav";
import { ShellProfileMenu } from "@/components/ashed-shell/ShellProfileMenu";
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
  ashed: AshedConnectionMeta | null;
  showAdminPortal?: boolean;
  showTeamAccess?: boolean;
  currentAllianceId?: string | null;
  membershipAlliances?: SessionAllianceOption[];
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
  ashed,
  showAdminPortal = false,
  showTeamAccess = false,
  currentAllianceId = null,
  membershipAlliances = [],
  children,
}: Props) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [expandedGroupId, setExpandedGroupId] = React.useState<string | null>(
    null,
  );

  const closeMobileNav = React.useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const openMobileNav = React.useCallback(() => {
    setExpandedGroupId(
      findActiveNavGroupId(pathname, {
        showAdminPortal,
        showTeamAccess,
      }),
    );
    setMobileNavOpen(true);
  }, [pathname, showAdminPortal, showTeamAccess]);

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
          <div className="flex min-h-screen min-h-[100dvh] bg-[#0d1117] text-[#e6edf3]">
          <div
            className={cn(
              "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ease-out md:hidden",
              mobileNavOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0",
            )}
            aria-hidden={!mobileNavOpen}
            onClick={closeMobileNav}
          />

          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex h-screen max-h-[100dvh] w-full max-w-[min(100vw,20rem)] flex-col border-r border-[#30363d] bg-[#161b22] transition-transform duration-300 ease-out md:sticky md:top-0 md:z-auto md:w-60 md:max-w-none md:shrink-0 md:self-start md:translate-x-0",
              mobileNavOpen
                ? "translate-x-0"
                : "-translate-x-full max-md:pointer-events-none",
            )}
          >
            <SidebarNav
              showAdminPortal={showAdminPortal}
              showTeamAccess={showTeamAccess}
              operatingMode={operatingMode}
              canUseAshedEmbeds={canUseAshedEmbeds}
              currentAllianceId={currentAllianceId}
              membershipAlliances={membershipAlliances}
              mobileCollapsible
              expandedGroupId={expandedGroupId}
              onToggleGroup={toggleGroup}
              onNavigate={closeMobileNav}
              onClose={closeMobileNav}
            />
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex min-h-[3.25rem] shrink-0 items-center gap-3 border-b border-[#30363d] bg-[#161b22] px-4 py-2 md:px-6 md:py-3">
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3] transition-colors hover:bg-[#21262d] md:hidden"
                onClick={openMobileNav}
                aria-label={t("openMenu")}
                aria-expanded={mobileNavOpen}
                aria-controls="hq-app-shell"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </button>

              <div className="min-w-0 flex-1 truncate text-sm text-[#8b949e]">
                {hasAppAccess && (isConnected || !canUseAshedEmbeds) ? (
                  <span className="hidden sm:inline">
                    {isNativeAlliance
                      ? t("nativeSignedInAs", {
                          user: userLabel ?? t("defaultUser"),
                        })
                      : t("connectedAs", {
                          user: userLabel ?? t("defaultUser"),
                        })}
                  </span>
                ) : (
                  <Link
                    href="/connect"
                    className="text-[#58a6ff] hover:underline"
                  >
                    {t("connectPrompt")}
                  </Link>
                )}
                {hasAppAccess ? (
                  <span className="truncate sm:hidden">
                    {userLabel ?? t("defaultUser")}
                  </span>
                ) : null}
                {hasAppAccess && !isConnected && canUseAshedEmbeds ? (
                  <Link
                    href="/connect"
                    className="text-[#58a6ff] hover:underline"
                  >
                    {t("connectPrompt")}
                  </Link>
                ) : null}
              </div>

              {hasAppAccess ? (
                <ShellProfileMenu
                  userLabel={userLabel}
                  displayName={displayName}
                  userEmail={userEmail}
                  avatarUrl={avatarUrl}
                  showAdminPortal={showAdminPortal}
                  isConnected={isConnected}
                  canUseAshedEmbeds={canUseAshedEmbeds}
                  showMenu={Boolean(userEmail || userLabel || displayName)}
                />
              ) : null}
            </header>

            <ReleaseNoticeBanner />
            {ashed ? <TokenExpiryBanner ashed={ashed} /> : null}
            <VideoJobStatusBanners />

            <main
              id="hq-app-shell"
              className="flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-6"
            >
              {children}
            </main>
          </div>
          </div>
        </FeedbackProvider>
      </ReleaseNotesProvider>
    </VideoJobEventsProvider>
  );
}
