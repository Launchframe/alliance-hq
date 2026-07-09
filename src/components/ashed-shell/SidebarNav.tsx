"use client";

import { createElement } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { useBeginNavigation } from "@/components/ashed-shell/ShellActivityProvider";
import { ashedLink } from "@/components/i18n/richText";
import { APP_VERSION } from "@/lib/feedback/constants";
import { SidebarAlliancePicker } from "@/components/ashed-shell/SidebarAlliancePicker";
import { navPageIcon } from "@/lib/nav/icons";
import type { SessionAllianceOption } from "@/lib/alliance/types";
import {
  FOOTER_NAV,
  NAV_GROUPS,
  filterNavGroupsForOperatingMode,
  filterNavGroupsForPermissions,
  navLinkActive,
} from "@/lib/nav/routes";
function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function NavLinkInner({
  pageId,
  label,
  active,
}: {
  pageId: string;
  label: string;
  active: boolean;
}) {
  const { pending } = useLinkStatus();
  const icon = navPageIcon(pageId);

  return (
    <>
      {icon
        ? createElement(icon, {
            className: cn(
              "h-4 w-4 shrink-0",
              pending && "opacity-60",
            ),
            "aria-hidden": true,
          })
        : null}
      <span
        className={cn(
          "min-w-0 truncate",
          pending && !active && "opacity-70",
        )}
      >
        {label}
      </span>
      {pending ? (
        <Loader2
          className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-hq-fg-muted"
          aria-hidden
        />
      ) : null}
    </>
  );
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
  const beginNavigation = useBeginNavigation();

  return (
    <Link
      href={href}
      onClick={() => {
        beginNavigation();
        onNavigate?.();
      }}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
        active
          ? "bg-hq-selected font-medium text-hq-selected-fg"
          : "text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg",
      )}
    >
      <NavLinkInner pageId={pageId} label={label} active={active} />
    </Link>
  );
}

type Props = {
  showAdminPortal?: boolean;
  showTeamAccess?: boolean;
  showVideoQueue?: boolean;
  showVideoProcessorsNav?: boolean;
  operatingMode?: "ashed" | "native" | null;
  canUseAshedEmbeds?: boolean;
  currentAllianceId?: string | null;
  membershipAlliances?: SessionAllianceOption[];
  isPlatformMaintainer?: boolean;
  sessionPermissions?: readonly string[];
  mobileCollapsible?: boolean;
  expandedGroupId: string | null;
  onToggleGroup: (groupId: string) => void;
  onNavigate?: () => void;
  onClose?: () => void;
};

export function SidebarNav({
  showAdminPortal = false,
  showTeamAccess = false,
  showVideoQueue = false,
  showVideoProcessorsNav = false,
  operatingMode = null,
  canUseAshedEmbeds = true,
  currentAllianceId = null,
  membershipAlliances = [],
  isPlatformMaintainer = false,
  sessionPermissions = [],
  mobileCollapsible = false,
  expandedGroupId,
  onToggleGroup,
  onNavigate,
  onClose,
}: Props) {
  const pathname = usePathname();
  const beginNavigation = useBeginNavigation();
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");
  const tNavGroups = useTranslations("navGroups");
  const tc = useTranslations("common");
  const permissionSet = new Set(sessionPermissions);
  const navGroups = filterNavGroupsForPermissions(
    filterNavGroupsForOperatingMode(NAV_GROUPS, operatingMode),
    permissionSet,
    { bypass: showAdminPortal },
  )
    .map((group) => ({
      ...group,
      pages: (
        canUseAshedEmbeds
          ? group.pages
          : group.pages.filter((page) => page.kind !== "iframe")
      ).filter(
        (page) =>
          (page.id !== "video-queue" || showVideoQueue) &&
          (page.id !== "video-processors" || showVideoProcessorsNav),
      ),
    }))
    .filter((group) => group.pages.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-hq-border px-4 py-4">
        <Link
          href={operatingMode === "native" ? "/members" : "/dashboard"}
          className="flex min-w-0 items-center gap-3"
          onClick={() => {
            beginNavigation();
            onNavigate?.();
          }}
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
            <span className="mt-0.5 block truncate text-xs text-hq-fg-muted">
              {t("domain")}
            </span>
          </span>
        </Link>
        {onClose ? (
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hq-border text-hq-fg md:hidden"
            onClick={onClose}
            aria-label={t("closeMenu")}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </div>

      <SidebarAlliancePicker
        key={currentAllianceId ?? "none"}
        initialCurrentAllianceId={currentAllianceId}
        initialAlliances={membershipAlliances}
        initialIsPlatformMaintainer={isPlatformMaintainer}
      />

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {navGroups.map((group) => {
          const extraPages =
            group.id === "alliance-management"
              ? [
                  ...(showTeamAccess
                    ? [
                        {
                          href: "/settings/team",
                          labelKey: "team" as const,
                          pageId: "team",
                        },
                      ]
                    : []),
                ]
              : group.id === "admin-settings"
                ? [
                    ...(showVideoQueue
                      ? [
                          {
                            href: "/tools/video-upload/queue",
                            labelKey: "videoQueue" as const,
                            pageId: "video-queue",
                          },
                        ]
                      : []),
                    ...(showAdminPortal
                      ? [
                          {
                            href: "/admin",
                            labelKey: "adminPortal" as const,
                            pageId: "admin-portal",
                          },
                        ]
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
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-hq-fg-subtle transition-colors",
                  mobileCollapsible &&
                    "hover:bg-hq-surface-muted hover:text-hq-fg-muted md:pointer-events-none md:hover:bg-transparent",
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
                        active={navLinkActive(pathname, page.href)}
                        onNavigate={onNavigate}
                      />
                    ))}
                    {extraPages.map((page) => (
                      <NavLink
                        key={page.href}
                        href={page.href}
                        pageId={page.pageId}
                        label={tNav(page.labelKey)}
                        active={
                          page.pageId === "admin-portal"
                            ? pathname.startsWith("/admin")
                            : navLinkActive(pathname, page.href)
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

        <div className="mt-2 border-t border-hq-border pt-2">
          {FOOTER_NAV.map((route) => (
            <a
              key={route.href}
              href={route.href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg px-3 py-1.5 text-sm text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
            >
              {tc("externalLink", { label: tNav(route.labelKey) })}
            </a>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-hq-border p-3 text-xs text-hq-fg-muted">
        <p>{t.rich("dataPoweredBy", { link: ashedLink })}</p>
        <p className="mt-1.5 font-mono text-[10px] text-hq-fg-subtle">
          {t("version", { version: APP_VERSION })}
        </p>
      </div>
    </div>
  );
}
