"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import { FeedbackProvider } from "@/components/feedback";
import { SidebarNav } from "@/components/ashed-shell/SidebarNav";
import { findActiveNavGroupId } from "@/lib/nav/routes";
import { TokenExpiryBanner } from "@/components/TokenExpiryNotice";
import {
  VideoJobEventsProvider,
  VideoJobStatusBanners,
} from "@/components/video/VideoJobEventsProvider";

type Props = {
  userLabel: string | null;
  isConnected: boolean;
  ashed: AshedConnectionMeta | null;
  showAdminPortal?: boolean;
  showTeamSettings?: boolean;
  children: React.ReactNode;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function AshedShell({
  userLabel,
  isConnected,
  ashed,
  showAdminPortal = false,
  showTeamSettings = false,
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
        showTeamSettings,
      }),
    );
    setMobileNavOpen(true);
  }, [pathname, showAdminPortal, showTeamSettings]);

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
              "fixed inset-y-0 left-0 z-50 flex w-full max-w-[min(100vw,20rem)] flex-col border-r border-[#30363d] bg-[#161b22] transition-transform duration-300 ease-out md:static md:z-auto md:w-60 md:max-w-none md:shrink-0 md:translate-x-0",
              mobileNavOpen
                ? "translate-x-0"
                : "-translate-x-full max-md:pointer-events-none",
            )}
          >
            <SidebarNav
              showAdminPortal={showAdminPortal}
              showTeamSettings={showTeamSettings}
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
                {isConnected ? (
                  <span className="hidden sm:inline">
                    {t("connectedAs", {
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
                {isConnected ? (
                  <span className="truncate sm:hidden">
                    {userLabel ?? t("defaultUser")}
                  </span>
                ) : null}
              </div>
            </header>

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
    </VideoJobEventsProvider>
  );
}
