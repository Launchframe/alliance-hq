export type NavRouteKind = "iframe" | "native" | "external";

export type NavPageDef = {
  id: string;
  labelKey: string;
  href: string;
  kind: NavRouteKind;
  /** When set, hide the link unless the session has this RBAC permission. */
  requiredPermission?: string;
  /** When set, hide the link when the session has this RBAC permission. */
  hideWhenPermission?: string;
  /**
   * Override for ashed.online iframe src when it is not trainwreckCase(href).
   * Normally omit — HQ kebab-case routes map by stripping hyphens.
   */
  ashedPath?: string;
  descriptionKey?: string;
};

export type NavGroupDef = {
  id: string;
  labelKey: string;
  pages: NavPageDef[];
};

/**
 * Ashed SPA paths: take HQ kebab-case and remove hyphens.
 * e.g. /desert-storm → /desertstorm, /waiting-list → /waitinglist
 */
export function trainwreckCase(hqPath: string): string {
  const segment = hqPath.replace(/^\//, "").replace(/-/g, "");
  return `/${segment}`;
}

export function resolveAshedPath(page: NavPageDef): string | undefined {
  if (page.kind !== "iframe") {
    return undefined;
  }
  return page.ashedPath ?? trainwreckCase(page.href);
}

export function filterNavGroupsForPermissions(
  groups: NavGroupDef[],
  permissions: ReadonlySet<string>,
  options: { bypass?: boolean } = {},
): NavGroupDef[] {
  if (options.bypass) {
    return groups;
  }

  return groups
    .map((group) => ({
      ...group,
      pages: group.pages.filter((page) => {
        if (page.hideWhenPermission && permissions.has(page.hideWhenPermission)) {
          return false;
        }
        return (
          !page.requiredPermission || permissions.has(page.requiredPermission)
        );
      }),
    }))
    .filter((group) => group.pages.length > 0);
}

export function filterNavGroupsForOperatingMode(
  groups: NavGroupDef[],
  operatingMode: "ashed" | "native" | null,
): NavGroupDef[] {
  if (operatingMode !== "native") {
    return groups;
  }

  return groups
    .map((group) => ({
      ...group,
      pages: group.pages.filter((page) => page.kind !== "iframe"),
    }))
    .filter((group) => group.pages.length > 0);
}

/** Sidebar groups mirroring docs/ashed-api-catalog.json navGroups */
export const NAV_GROUPS: NavGroupDef[] = [
  {
    id: "alliance-management",
    labelKey: "allianceManagement",
    pages: [
      {
        id: "dashboard",
        labelKey: "dashboard",
        href: "/dashboard",
        kind: "iframe",
      },
      {
        id: "alliances",
        labelKey: "alliances",
        href: "/alliances",
        kind: "iframe",
      },
      {
        id: "members",
        labelKey: "members",
        href: "/members",
        kind: "native",
        descriptionKey: "membersDescription",
      },
      {
        id: "commanders",
        labelKey: "commanders",
        href: "/commanders",
        kind: "native",
        requiredPermission: "members:read",
        descriptionKey: "commandersDescription",
      },
      {
        id: "waiting-list",
        labelKey: "waitingList",
        href: "/waiting-list",
        kind: "iframe",
      },
      {
        id: "alliance-tasks",
        labelKey: "allianceTasks",
        href: "/alliance-tasks",
        kind: "iframe",
      },
      {
        id: "merge-manager",
        labelKey: "mergeManager",
        href: "/merge-manager",
        kind: "iframe",
      },
      {
        id: "alliance-settings",
        labelKey: "allianceSettings",
        href: "/settings",
        kind: "native",
      },
    ],
  },
  {
    id: "performance-reporting",
    labelKey: "performanceReporting",
    pages: [
      {
        id: "vs-performance",
        labelKey: "vsPerformance",
        href: "/vs-performance",
        kind: "iframe",
      },
      {
        id: "donations",
        labelKey: "donations",
        href: "/donations",
        kind: "iframe",
      },
      {
        id: "alliance-exercise",
        labelKey: "allianceExercise",
        href: "/alliance-exercise",
        kind: "iframe",
      },
      {
        id: "reports",
        labelKey: "reports",
        href: "/reports",
        kind: "iframe",
      },
      {
        id: "viral-resistance",
        labelKey: "viralResistance",
        href: "/viral-resistance",
        kind: "native",
        descriptionKey: "viralResistanceDescription",
        requiredPermission: "members:write",
      },
      {
        id: "my-vr",
        labelKey: "myVr",
        href: "/my-vr",
        kind: "native",
        descriptionKey: "myVrDescription",
        hideWhenPermission: "members:write",
      },
      {
        id: "trains",
        labelKey: "trains",
        href: "/trains",
        kind: "native",
        descriptionKey: "trainsDescription",
      },
    ],
  },
  {
    id: "events-operations",
    labelKey: "eventsOperations",
    pages: [
      {
        id: "desert-storm",
        labelKey: "desertStorm",
        href: "/desert-storm",
        kind: "iframe",
      },
      {
        id: "canyon-storm",
        labelKey: "canyonStorm",
        href: "/canyon-storm",
        kind: "iframe",
      },
      {
        id: "other-events",
        labelKey: "otherEvents",
        href: "/seasonal-events",
        kind: "iframe",
      },
      {
        id: "zombie-siege",
        labelKey: "zombieSiege",
        href: "/zombie-siege",
        kind: "iframe",
      },
    ],
  },
  {
    id: "admin-settings",
    labelKey: "adminSettings",
    pages: [
      {
        id: "data-management",
        labelKey: "dataManagement",
        href: "/data-management",
        kind: "iframe",
      },
      {
        id: "unmatched-names",
        labelKey: "unmatchedNames",
        href: "/unmatched-names",
        kind: "iframe",
      },
    ],
  },
  {
    id: "video",
    labelKey: "video",
    pages: [
      {
        id: "video-upload",
        labelKey: "videoUpload",
        href: "/tools/video-upload",
        kind: "native",
        descriptionKey: "videoUploadDescription",
        requiredPermission: "hq:video:enqueue",
      },
      {
        id: "video-queue",
        labelKey: "videoQueue",
        href: "/tools/video-upload/queue",
        kind: "native",
      },
      {
        id: "video-processors",
        labelKey: "videoProcessors",
        href: "/tools/video-processors",
        kind: "native",
        descriptionKey: "videoProcessorsDescription",
      },
    ],
  },
  {
    id: "support",
    labelKey: "support",
    pages: [
      {
        id: "discord-bot-guide",
        labelKey: "discordBotGuide",
        href: "/guides/discord-bot",
        kind: "native",
        descriptionKey: "discordBotGuideDescription",
      },
      {
        id: "discord-train-guide",
        labelKey: "discordTrainGuide",
        href: "/guides/discord-train",
        kind: "native",
        descriptionKey: "discordTrainGuideDescription",
      },
      {
        id: "alliance-onboarding-guide",
        labelKey: "allianceOnboardingGuide",
        href: "/guides/alliance-onboarding",
        kind: "native",
        descriptionKey: "allianceOnboardingGuideDescription",
      },
    ],
  },
];

export const FOOTER_NAV: NavPageDef[] = [
  {
    id: "open-ashed",
    labelKey: "openAshed",
    href: "https://ashed.online",
    kind: "external",
  },
];

export const ASHED_ORIGIN = "https://ashed.online";

const IFRAME_PAGES = NAV_GROUPS.flatMap((g) => g.pages).filter(
  (p) => p.kind === "iframe",
);

/** Segment after locale, e.g. "members" for /members */
export const IFRAME_ROUTE_SEGMENTS = new Set(
  IFRAME_PAGES.map((p) => p.href.replace(/^\//, "")),
);

/** @deprecated Use NAV_GROUPS — kept for any legacy imports */
export const NAV_ROUTE_DEFS: NavPageDef[] = [
  ...NAV_GROUPS.flatMap((g) => g.pages),
  ...FOOTER_NAV,
];

const LEGACY_ASHED_REDIRECTS: Record<string, string> = {
  reports: "/reports",
  members: "/members",
  violations: "/members",
};

/** Old HQ paths before trainwreckCase wiring */
const LEGACY_IFRAME_HQ_SEGMENTS: Record<string, string> = {
  "other-events": "/seasonal-events",
};

export function ashedUrlForPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${ASHED_ORIGIN}${normalized}`;
}

export function resolveIframePage(segment: string): NavPageDef | null {
  const href = LEGACY_IFRAME_HQ_SEGMENTS[segment] ?? `/${segment}`;
  return IFRAME_PAGES.find((p) => p.href === href) ?? null;
}

export function legacyAshedRedirect(pathSegments: string[]): string | null {
  if (pathSegments.length !== 1) {
    return null;
  }
  const target = LEGACY_ASHED_REDIRECTS[pathSegments[0]!];
  return target ?? null;
}

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Nav link active state — parent hubs (e.g. /settings) do not highlight on child routes. */
export function navLinkActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/settings") {
    return pathname === "/settings";
  }
  if (href === "/account") {
    return pathname === "/account";
  }
  if (href === "/profile") {
    return pathname === "/profile";
  }
  if (href === "/tools/video-upload/queue") {
    return pathname === "/tools/video-upload/queue";
  }
  if (href === "/tools/video-processors") {
    return pathname === "/tools/video-processors";
  }
  if (href === "/guides/discord-bot") {
    return pathname === "/guides/discord-bot" || pathname.startsWith("/guides/discord-bot/");
  }
  if (href === "/guides/discord-train") {
    return pathname === "/guides/discord-train" || pathname.startsWith("/guides/discord-train/");
  }
  if (href === "/guides/alliance-onboarding") {
    return (
      pathname === "/guides/alliance-onboarding" ||
      pathname.startsWith("/guides/alliance-onboarding/")
    );
  }
  if (href === "/tools/video-upload") {
    if (pathname === "/tools/video-upload/queue") {
      return false;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function findActiveNavGroupId(
  pathname: string,
  options: {
    showAdminPortal?: boolean;
    showTeamAccess?: boolean;
    showAllianceSettings?: boolean;
  } = {},
): string | null {
  const {
    showAdminPortal = false,
    showTeamAccess = false,
    showAllianceSettings = false,
  } = options;

  for (const group of NAV_GROUPS) {
    if (group.pages.some((page) => navLinkActive(pathname, page.href))) {
      return group.id;
    }

    if (group.id === "alliance-management") {
      const extraHrefs: string[] = [];
      if (showTeamAccess) {
        extraHrefs.push("/settings/team");
      }
      if (showAllianceSettings) {
        extraHrefs.push(
          "/settings/discord",
          "/settings/trains",
          "/settings/upload-reminders",
        );
      }
      if (extraHrefs.some((href) => navLinkActive(pathname, href))) {
        return group.id;
      }
      continue;
    }

    if (group.id === "admin-settings") {
      if (showAdminPortal && pathname.startsWith("/admin")) {
        return group.id;
      }
    }

    if (group.id === "support") {
      if (pathname.startsWith("/guides/discord-bot")) {
        return group.id;
      }
      if (pathname.startsWith("/guides/discord-train")) {
        return group.id;
      }
      if (pathname.startsWith("/guides/alliance-onboarding")) {
        return group.id;
      }
    }
  }

  return null;
}
