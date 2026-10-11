"use client";

import { createElement, useCallback, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, Star, X } from "lucide-react";
import Image from "next/image";
import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { SidebarAppearanceToggle } from "@/components/appearance/SidebarAppearanceToggle";
import { useBeginNavigation } from "@/components/ashed-shell/ShellActivityProvider";
import { ashedLink } from "@/components/i18n/richText";
import { APP_VERSION } from "@/lib/feedback/constants";
import { SidebarAlliancePicker } from "@/components/ashed-shell/SidebarAlliancePicker";
import { navPageIcon } from "@/lib/nav/icons";
import type { SessionAllianceOption } from "@/lib/alliance/types";
import type { NavigationPreferences } from "@/lib/nav/preferences.shared";
import {
  destinationById,
  destinationIsVisible,
  findActiveDestination,
  resolveVisibleAdminNav,
  resolveVisibleAppNav,
  type NavContext,
  type NavDestination,
  type NavFamily,
  type VisibleSection,
} from "@/lib/nav/registry";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type DestinationRowProps = {
  destination: NavDestination;
  active: boolean;
  isFavorite: boolean;
  showStar: boolean;
  onToggleFavorite: (destinationId: string) => void;
  onNavigate?: () => void;
  label?: string;
};

function DestinationRow({
  destination,
  active,
  isFavorite,
  showStar,
  onToggleFavorite,
  onNavigate,
  label,
}: DestinationRowProps) {
  const { pending } = useLinkStatus();
  const beginNavigation = useBeginNavigation();
  const tNav = useTranslations("nav");
  const icon = navPageIcon(destination.iconKey);
  const displayLabel = label ?? tNav(destination.labelKey);

  return (
    <div
      className={cn(
        "group flex items-center rounded-lg",
        active ? "bg-hq-selected" : "hover:bg-hq-surface-muted",
      )}
    >
      <Link
        href={destination.href}
        onClick={() => {
          beginNavigation();
          onNavigate?.();
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-sm",
          active
            ? "font-medium text-hq-selected-fg"
            : "text-hq-fg-muted hover:text-hq-fg",
        )}
      >
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
          {displayLabel}
        </span>
        {pending ? (
          <Loader2
            className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-hq-fg-muted"
            aria-hidden
          />
        ) : null}
      </Link>
      {showStar ? (
        <button
          type="button"
          onClick={() => onToggleFavorite(destination.id)}
          className={cn(
            "shrink-0 px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-hq-accent",
            active ? "text-hq-selected-fg" : "text-hq-fg-subtle",
          )}
          aria-label={
            isFavorite
              ? tNav("removeFavorite", { page: displayLabel })
              : tNav("addFavorite", { page: displayLabel })
          }
          aria-pressed={isFavorite}
        >
          <Star
            className={cn(
              "h-4 w-4",
              isFavorite ? "fill-current text-hq-accent" : "opacity-60",
            )}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
}

type FamilyDisclosureProps = {
  family: NavFamily & { destinations: NavDestination[] };
  activeDestination: NavDestination | undefined;
  isOfficer: boolean;
  favorites: Set<string>;
  onToggleFavorite: (destinationId: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
};

function FamilyDisclosure({
  family,
  activeDestination,
  isOfficer,
  favorites,
  onToggleFavorite,
  isExpanded,
  onToggle,
  onNavigate,
}: FamilyDisclosureProps) {
  const tNav = useTranslations("nav");
  const icon = navPageIcon(
    family.id === "stats" && isOfficer ? "allianceStats" : family.iconKey,
  );
  const label =
    family.id === "stats"
      ? isOfficer
        ? tNav("allianceStats")
        : tNav("personalStats")
      : tNav(family.labelKey);

  const hasActiveChild = family.destinations.some(
    (d) => activeDestination?.id === d.id,
  );

  return (
    <div className="mb-0.5 last:mb-0">
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
          hasActiveChild
            ? "bg-hq-selected font-medium text-hq-selected-fg"
            : "text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg",
        )}
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-2">
          {icon
            ? createElement(icon, {
                className: "h-4 w-4 shrink-0",
                "aria-hidden": true,
              })
            : null}
          <span className="min-w-0 truncate">{label}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            isExpanded && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 py-0.5 pl-3">
            {family.destinations.map((destination) => (
              <DestinationRow
                key={destination.id}
                destination={destination}
                active={activeDestination?.id === destination.id}
                isFavorite={favorites.has(destination.id)}
                showStar
                onToggleFavorite={onToggleFavorite}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type SectionGroupProps = {
  section: VisibleSection;
  activeDestination: NavDestination | undefined;
  favorites: Set<string>;
  onToggleFavorite: (destinationId: string) => void;
  expandedGroupIds: Set<string>;
  onToggleGroup: (groupId: string) => void;
  onNavigate?: () => void;
  isOfficer: boolean;
};

function SectionGroup({
  section,
  activeDestination,
  favorites,
  onToggleFavorite,
  expandedGroupIds,
  onToggleGroup,
  onNavigate,
  isOfficer,
}: SectionGroupProps) {
  const tNav = useTranslations("nav");

  return (
    <div className="mb-3 last:mb-0">
      <h3 className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-hq-fg-subtle">
        {tNav(section.labelKey)}
      </h3>
      <div className="space-y-0.5">
        {section.standalone.map((destination) => (
          <DestinationRow
            key={destination.id}
            destination={destination}
            active={activeDestination?.id === destination.id}
            isFavorite={favorites.has(destination.id)}
            showStar
            onToggleFavorite={onToggleFavorite}
            onNavigate={onNavigate}
          />
        ))}
        {section.families.map((family) => (
          <FamilyDisclosure
            key={family.id}
            family={family}
            activeDestination={activeDestination}
            isOfficer={isOfficer}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            isExpanded={expandedGroupIds.has(family.id)}
            onToggle={() => onToggleGroup(family.id)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

type Props = {
  context?: NavContext;
  navigationPreferences: NavigationPreferences;
  showAdminPortal?: boolean;
  showTeamAccess?: boolean;
  showVideoQueue?: boolean;
  showVideoJobsOps?: boolean;
  showVideoProcessorsNav?: boolean;
  operatingMode?: "ashed" | "native" | null;
  canUseAshedEmbeds?: boolean;
  currentAllianceId?: string | null;
  membershipAlliances?: SessionAllianceOption[];
  isPlatformMaintainer?: boolean;
  hasAllianceMemberLink?: boolean;
  sessionPermissions?: readonly string[];
  expandedGroupId: string | null;
  onToggleGroup: (groupId: string) => void;
  onNavigate?: () => void;
  onClose?: () => void;
};

export function SidebarNav({
  context = "app",
  navigationPreferences,
  showAdminPortal = false,
  showTeamAccess = false,
  showVideoQueue = false,
  showVideoJobsOps = false,
  showVideoProcessorsNav = false,
  operatingMode = null,
  canUseAshedEmbeds = true,
  currentAllianceId = null,
  membershipAlliances = [],
  isPlatformMaintainer = false,
  hasAllianceMemberLink = false,
  sessionPermissions = [],
  expandedGroupId,
  onToggleGroup,
  onNavigate,
  onClose,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const beginNavigation = useBeginNavigation();
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");

  const permissionSet = useMemo(
    () => new Set(sessionPermissions),
    [sessionPermissions],
  );
  const isOfficer = permissionSet.has("members:write") || isPlatformMaintainer;

  const [optimisticFavorites, setOptimisticFavorites] = useState(
    new Set(navigationPreferences.favorites),
  );

  const [showAshedPages, setShowAshedPages] = useState(
    navigationPreferences.showAshedPages,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState(false);

  const activeDestination = useMemo(
    () => findActiveDestination(pathname, context),
    [pathname, context],
  );

  const visibleSections = useMemo(() => {
    const options = {
      permissions: permissionSet,
      hasAllianceMemberLink,
      operatingMode,
      canUseAshedEmbeds,
      showAshedPages,
      showVideoQueue,
      showVideoJobsOps,
      showVideoProcessorsNav,
      showTeamAccess,
      showAdminPortal,
      isPlatformMaintainer,
    };
    return context === "admin"
      ? resolveVisibleAdminNav(options)
      : resolveVisibleAppNav(options);
  }, [
    context,
    permissionSet,
    hasAllianceMemberLink,
    operatingMode,
    canUseAshedEmbeds,
    showAshedPages,
    showVideoQueue,
    showVideoJobsOps,
    showVideoProcessorsNav,
    showTeamAccess,
    showAdminPortal,
    isPlatformMaintainer,
  ]);

  const allVisibleDestinations = useMemo(() => {
    const result: NavDestination[] = [];
    for (const section of visibleSections) {
      for (const d of section.standalone) result.push(d);
      for (const family of section.families) {
        for (const d of family.destinations) result.push(d);
      }
    }
    return result;
  }, [visibleSections]);

  const favoriteDestinations = useMemo(() => {
    return Array.from(optimisticFavorites)
      .map((id) => destinationById(id))
      .filter((d): d is NavDestination => {
        if (!d) return false;
        return allVisibleDestinations.some((vd) => vd.id === d.id);
      });
  }, [optimisticFavorites, allVisibleDestinations]);

  const recentDestinations = useMemo(() => {
    return navigationPreferences.recents
      .map((id) => destinationById(id))
      .filter((d): d is NavDestination => {
        if (!d) return false;
        if (d.id === activeDestination?.id) return false;
        return allVisibleDestinations.some((vd) => vd.id === d.id);
      })
      .slice(0, 5);
  }, [navigationPreferences.recents, activeDestination, allVisibleDestinations]);

  const expandedGroupIds = useMemo(() => {
    const ids = new Set<string>();
    if (expandedGroupId) {
      ids.add(expandedGroupId);
    }
    // Auto-expand the active family so the current page is visible.
    if (activeDestination?.familyId) {
      ids.add(activeDestination.familyId);
    }
    return ids;
  }, [expandedGroupId, activeDestination]);

  const handleToggleFavorite = useCallback(
    async (destinationId: string) => {
      const wasFavorite = optimisticFavorites.has(destinationId);
      const next = new Set(optimisticFavorites);
      if (wasFavorite) {
        next.delete(destinationId);
      } else {
        next.add(destinationId);
      }
      setOptimisticFavorites(next);
      setSaveError(null);

      try {
        const response = await fetch("/api/account/navigation-preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationId }),
        });
        if (!response.ok) {
          throw new Error("Failed to update favorite");
        }
      } catch {
        // Roll back on failure.
        setOptimisticFavorites(new Set(optimisticFavorites));
        setSaveError(tNav("saveNavigationError"));
      }
    },
    [optimisticFavorites, tNav],
  );

  const handleToggleAshed = useCallback(async () => {
    if (pendingToggle) return;
    const next = !showAshedPages;
    setShowAshedPages(next);
    setPendingToggle(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/account/navigation-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showAshedPages: next }),
      });
      if (!response.ok) {
        throw new Error("Failed to update Ashed preference");
      }

      // If the current page is hidden by the new preference, redirect to
      // the dashboard. Otherwise refresh server-rendered content so hybrid
      // panes and Ashed-only destinations disappear/reappear.
      const active = activeDestination;
      if (active) {
        const visibleAfterToggle = destinationIsVisible(active, {
          permissions: permissionSet,
          hasAllianceMemberLink,
          operatingMode,
          canUseAshedEmbeds,
          showAshedPages: next,
          showVideoQueue,
          showVideoJobsOps,
          showVideoProcessorsNav,
          showTeamAccess,
          showAdminPortal,
          isPlatformMaintainer,
        });
        if (!visibleAfterToggle) {
          router.push("/dashboard");
          return;
        }
      }
      router.refresh();
    } catch {
      setShowAshedPages(showAshedPages);
      setSaveError(tNav("saveNavigationError"));
    } finally {
      setPendingToggle(false);
    }
  }, [
    pendingToggle,
    showAshedPages,
    activeDestination,
    permissionSet,
    hasAllianceMemberLink,
    operatingMode,
    canUseAshedEmbeds,
    showVideoQueue,
    showVideoJobsOps,
    showVideoProcessorsNav,
    showTeamAccess,
    showAdminPortal,
    isPlatformMaintainer,
    router,
    tNav,
  ]);

  const showAshedToggle =
    context === "app" && canUseAshedEmbeds && operatingMode !== "native";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-hq-border px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-3"
            onClick={() => {
              beginNavigation();
              onNavigate?.();
            }}
          >
            <Image
              src="/brand/hq-icon-mark.svg"
              alt=""
              width={36}
              height={36}
              priority
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
        <p className="mt-3 w-full text-xs leading-snug text-hq-fg-muted">
          {t("slogan")}
        </p>
      </div>

      <SidebarAlliancePicker
        key={currentAllianceId ?? "none"}
        initialCurrentAllianceId={currentAllianceId}
        initialAlliances={membershipAlliances}
        initialIsPlatformMaintainer={isPlatformMaintainer}
      />

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {context === "app" && favoriteDestinations.length > 0 ? (
          <div className="mb-3">
            <h3 className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-hq-fg-subtle">
              {tNav("favorites")}
            </h3>
            <div className="space-y-0.5">
              {favoriteDestinations.map((destination) => (
                <DestinationRow
                  key={destination.id}
                  destination={destination}
                  active={activeDestination?.id === destination.id}
                  isFavorite
                  showStar
                  onToggleFavorite={handleToggleFavorite}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ) : null}

        {context === "app" && recentDestinations.length > 0 ? (
          <div className="mb-3">
            <h3 className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-hq-fg-subtle">
              {tNav("recent")}
            </h3>
            <div className="space-y-0.5">
              {recentDestinations.map((destination) => (
                <DestinationRow
                  key={destination.id}
                  destination={destination}
                  active={activeDestination?.id === destination.id}
                  isFavorite={optimisticFavorites.has(destination.id)}
                  showStar
                  onToggleFavorite={handleToggleFavorite}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ) : null}

        {visibleSections.map((section) => (
          <SectionGroup
            key={section.id}
            section={section}
            activeDestination={activeDestination}
            favorites={optimisticFavorites}
            onToggleFavorite={handleToggleFavorite}
            expandedGroupIds={expandedGroupIds}
            onToggleGroup={onToggleGroup}
            onNavigate={onNavigate}
            isOfficer={isOfficer}
          />
        ))}

        {saveError ? (
          <p className="mt-2 px-3 text-xs text-hq-danger">{saveError}</p>
        ) : null}
      </nav>

      <div className="shrink-0 border-t border-hq-border p-3 text-xs text-hq-fg-muted">
        {showAshedToggle ? (
          <button
            type="button"
            onClick={handleToggleAshed}
            disabled={pendingToggle}
            className="mb-3 flex w-full items-center justify-between rounded-lg border border-hq-border px-3 py-2 text-left transition-colors hover:bg-hq-surface-muted"
            aria-checked={showAshedPages}
            role="switch"
          >
            <span className="flex items-center gap-2">
              {tNav("showAshedPages")}
            </span>
            <span
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
                showAshedPages ? "bg-hq-accent" : "bg-hq-border",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  showAshedPages ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </span>
          </button>
        ) : null}
        <a
          href="https://ashed.online"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          {tNav("openAshed")}
        </a>
        <SidebarAppearanceToggle />
        <p>{t.rich("dataPoweredBy", { link: ashedLink })}</p>
        <p className="mt-1.5 font-mono text-[10px] text-hq-fg-subtle">
          {t("version", { version: APP_VERSION })}
        </p>
      </div>
    </div>
  );
}
