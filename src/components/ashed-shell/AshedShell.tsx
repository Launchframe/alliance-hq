"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { FOOTER_NAV, NAV_GROUPS, isNavActive } from "@/lib/nav/routes";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import { TokenExpiryBanner } from "@/components/TokenExpiryNotice";
import { VideoJobEventsProvider, VideoJobStatusBanners } from "@/components/video/VideoJobEventsProvider";
import { ashedLink } from "@/components/i18n/richText";

type Props = {
  userLabel: string | null;
  isConnected: boolean;
  ashed: AshedConnectionMeta | null;
  children: React.ReactNode;
};

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-1.5 text-sm ${
        active
          ? "bg-[#1f3d5c] font-medium text-[#58a6ff]"
          : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
      }`}
    >
      {label}
    </Link>
  );
}

export function AshedShell({ userLabel, isConnected, ashed, children }: Props) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");
  const tNavGroups = useTranslations("navGroups");
  const tc = useTranslations("common");

  return (
    <VideoJobEventsProvider>
      <div className="flex min-h-screen bg-[#0d1117] text-[#e6edf3]">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[#30363d] bg-[#161b22]">
        <div className="border-b border-[#30363d] px-4 py-4">
          <Link href="/dashboard" className="block">
            <span className="text-lg font-semibold tracking-tight">
              {t("brand")}
            </span>
            <span className="mt-0.5 block text-xs text-[#8b949e]">
              {t("domain")}
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-4 last:mb-0">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                {tNavGroups(group.labelKey)}
              </p>
              <div className="space-y-0.5">
                {group.pages.map((page) => (
                  <NavLink
                    key={page.href}
                    href={page.href}
                    label={tNav(page.labelKey)}
                    active={isNavActive(pathname, page.href)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="mt-2 border-t border-[#30363d] pt-2">
            {FOOTER_NAV.map((route) => (
              <a
                key={route.href}
                href={route.href}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg px-3 py-1.5 text-sm text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              >
                {tc("externalLink", { label: tNav(route.labelKey) })}
              </a>
            ))}
          </div>
        </nav>

        <div className="border-t border-[#30363d] p-3 text-xs text-[#8b949e]">
          <p>{t.rich("dataPoweredBy", { link: ashedLink })}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[#30363d] bg-[#161b22] px-6 py-3">
          <div className="text-sm text-[#8b949e]">
            {isConnected ? (
              <>
                {t("connectedAs", {
                  user: userLabel ?? t("defaultUser"),
                })}
              </>
            ) : (
              <Link href="/connect" className="text-[#58a6ff] hover:underline">
                {t("connectPrompt")}
              </Link>
            )}
          </div>
        </header>

        {ashed && <TokenExpiryBanner ashed={ashed} />}
        <VideoJobStatusBanners />

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
    </VideoJobEventsProvider>
  );
}
