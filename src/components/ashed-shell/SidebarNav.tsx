"use client";

import { createElement } from "react";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { ashedLink } from "@/components/i18n/richText";
import { APP_VERSION } from "@/lib/feedback/constants";
import { navPageIcon } from "@/lib/nav/icons";
import {
  FOOTER_NAV,
  NAV_GROUPS,
  filterNavGroupsForOperatingMode,
  isNavActive,
} from "@/lib/nav/routes";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function NavLink({
  href,
  pageId,
  label,
  active,
  onNavigate,
}: {
  href: string;
  pageId: string;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const icon = navPageIcon(pageId);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
        active
          ? "bg-[#1f3d5c] font-medium text-[#58a6ff]"
          : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]",
      )}
    >
      {icon
        ? createElement(icon, {
            className: "h-4 w-4 shrink-0",
            "aria-hidden": true,
          })
        : null}
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

type Props = {
  showAdminPortal?: boolean;
  showTeamSettings?: boolean;
  operatingMode?: "ashed" | "native" | null;
  mobileCollapsible?: boolean;
  expandedGroupId: string | null;
  onToggleGroup: (groupId: string) => void;
  onNavigate?: () => void;
  onClose?: () => void;
};

export function SidebarNav({
  showAdminPortal = false,
  showTeamSettings = false,
  operatingMode = null,
  mobileCollapsible = false,
  expandedGroupId,
  onToggleGroup,
  onNavigate,
  onClose,
}: Props) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");
  const tNavGroups = useTranslations("navGroups");
  const tc = useTranslations("common");
  const navGroups = filterNavGroupsForOperatingMode(NAV_GROUPS, operatingMode);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-[#30363d] px-4 py-4">
        <Link
          href={operatingMode === "native" ? "/members" : "/dashboard"}
          className="flex min-w-0 items-center gap-3"
          onClick={onNavigate}
        >
          <img
            src="/brand/hq-icon-mark.svg"
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg"
          />
          <span className="min-w-0">
            <span className="block text-lg font-semibold tracking-tight">
              {t("brand")}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[#8b949e]">
              {t("domain")}
            </span>
          </span>
        </Link>
        {onClose ? (
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3] md:hidden"
            onClick={onClose}
            aria-label={t("closeMenu")}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {navGroups.map((group) => {
          const extraPages =
            group.id === "hq-native"
              ? [
                  ...(showTeamSettings
                    ? [{ href: "/settings/team", labelKey: "team" as const }]
                    : []),
                  ...(showAdminPortal
                    ? [{ href: "/admin", labelKey: "adminPortal" as const }]
                    : []),
                ]
              : [];

          const isExpanded =
            !mobileCollapsible || expandedGroupId === group.id;

          return (
            <div key={group.id} className="mb-2 last:mb-0">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#6e7681] transition-colors",
                  mobileCollapsible &&
                    "hover:bg-[#21262d] hover:text-[#8b949e] md:pointer-events-none md:hover:bg-transparent",
                )}
                onClick={() => {
                  if (mobileCollapsible) {
                    onToggleGroup(group.id);
                  }
                }}
                aria-expanded={isExpanded}
              >
                <span>{tNavGroups(group.labelKey)}</span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-300 ease-out md:hidden",
                    isExpanded && "rotate-180",
                  )}
                />
              </button>

              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-300 ease-out md:grid-rows-[1fr]",
                  isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <div className="space-y-0.5 pb-2 pt-0.5">
                    {group.pages.map((page) => (
                      <NavLink
                        key={page.href}
                        href={page.href}
                        pageId={page.id}
                        label={tNav(page.labelKey)}
                        active={isNavActive(pathname, page.href)}
                        onNavigate={onNavigate}
                      />
                    ))}
                    {extraPages.map((page) => (
                      <NavLink
                        key={page.href}
                        href={page.href}
                        pageId={page.labelKey}
                        label={tNav(page.labelKey)}
                        active={
                          page.href === "/admin"
                            ? pathname.startsWith("/admin")
                            : isNavActive(pathname, page.href)
                        }
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

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

      <div className="shrink-0 border-t border-[#30363d] p-3 text-xs text-[#8b949e]">
        <p>{t.rich("dataPoweredBy", { link: ashedLink })}</p>
        <p className="mt-1.5 font-mono text-[10px] text-[#6e7681]">
          {t("version", { version: APP_VERSION })}
        </p>
      </div>
    </div>
  );
}
