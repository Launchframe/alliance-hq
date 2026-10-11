import { navLinkActive as routeNavLinkActive } from "@/lib/nav/routes";

export type NavSurface = "native" | "ashed-only" | "hybrid";

export type NavContext = "app" | "admin";

export type NavDestination = {
  id: string;
  labelKey: string;
  href: string;
  surface: NavSurface;
  context: NavContext;
  /** Icon key looked up in NAV_ICON_MAP. */
  iconKey: string;
  /** Optional legacy hrefs that should redirect to the canonical href. */
  legacyHrefs?: string[];
  /** When set, hide the destination unless the session has this RBAC permission. */
  requiredPermission?: string;
  /** When set, hide the destination when the session has this RBAC permission. */
  hideWhenPermission?: string;
  /** When true, hide unless the user has an HQ member link in the current alliance. */
  requiresAllianceMemberLink?: boolean;
  /** Override for ashed.online iframe src when it is not trainwreckCase(href). */
  ashedPath?: string;
  /** Optional i18n key for a one-line description used in tooltips/empty states. */
  descriptionKey?: string;
  /** Whether this destination can be starred and tracked in recents. */
  favoriteable?: boolean;
  /** Which family (if any) this destination belongs to. */
  familyId?: string;
  /** Which top-level section this destination belongs to. */
  sectionId: string;
};

export type NavFamily = {
  id: string;
  labelKey: string;
  iconKey: string;
  sectionId: string;
  /** If the whole family should be hidden without this permission. */
  requiredPermission?: string;
};

export type NavSection = {
  id: string;
  labelKey: string;
  context: NavContext;
};

export const APP_NAV_SECTIONS: NavSection[] = [
  { id: "dashboard", labelKey: "dashboard", context: "app" },
  { id: "alliance", labelKey: "alliance", context: "app" },
  { id: "performance", labelKey: "performance", context: "app" },
  { id: "operations", labelKey: "operations", context: "app" },
  { id: "tools", labelKey: "toolsAndSettings", context: "app" },
  { id: "help", labelKey: "help", context: "app" },
];

export const ADMIN_NAV_SECTIONS: NavSection[] = [
  { id: "admin-overview", labelKey: "adminOverview", context: "admin" },
  { id: "admin-support", labelKey: "supportOperations", context: "admin" },
  { id: "admin-orgs", labelKey: "organizationsAndPeople", context: "admin" },
  { id: "admin-video", labelKey: "videoPipeline", context: "admin" },
  { id: "admin-quality", labelKey: "productQuality", context: "admin" },
  { id: "admin-platform", labelKey: "platform", context: "admin" },
];

export const APP_NAV_FAMILIES: NavFamily[] = [
  { id: "people", labelKey: "people", iconKey: "people", sectionId: "alliance" },
  { id: "professions", labelKey: "professions", iconKey: "professions", sectionId: "alliance" },
  { id: "alliance-admin", labelKey: "allianceAdministration", iconKey: "allianceAdministration", sectionId: "alliance" },
  { id: "stats", labelKey: "personalStats", iconKey: "personalStats", sectionId: "performance" },
  { id: "vs", labelKey: "vs", iconKey: "vs", sectionId: "performance" },
  { id: "contributions", labelKey: "contributions", iconKey: "contributions", sectionId: "performance" },
  { id: "trains", labelKey: "trains", iconKey: "trains", sectionId: "operations" },
  { id: "events", labelKey: "events", iconKey: "events", sectionId: "operations" },
  { id: "data-tools", labelKey: "dataTools", iconKey: "dataTools", sectionId: "tools" },
  { id: "video-tools", labelKey: "videoTools", iconKey: "videoTools", sectionId: "tools" },
  { id: "guides", labelKey: "guides", iconKey: "guides", sectionId: "help" },
];

export const ADMIN_NAV_FAMILIES: NavFamily[] = [
  { id: "admin-overview", labelKey: "adminOverview", iconKey: "adminOverview", sectionId: "admin-overview" },
  { id: "admin-support", labelKey: "supportOperations", iconKey: "supportOperations", sectionId: "admin-support" },
  { id: "admin-orgs", labelKey: "organizationsAndPeople", iconKey: "organizationsAndPeople", sectionId: "admin-orgs" },
  { id: "admin-video", labelKey: "videoPipeline", iconKey: "videoPipeline", sectionId: "admin-video" },
  { id: "admin-quality", labelKey: "productQuality", iconKey: "productQuality", sectionId: "admin-quality" },
  { id: "admin-platform", labelKey: "platform", iconKey: "platform", sectionId: "admin-platform" },
];

export const APP_NAV_DESTINATIONS: NavDestination[] = [
  // Dashboard
  {
    id: "dashboard",
    labelKey: "dashboard",
    href: "/dashboard",
    surface: "native",
    context: "app",
    iconKey: "dashboard",
    favoriteable: true,
    sectionId: "dashboard",
    descriptionKey: "dashboardDescription",
  },

  // Alliance > Activity
  {
    id: "activity",
    labelKey: "activity",
    href: "/activity",
    surface: "native",
    context: "app",
    iconKey: "activity",
    favoriteable: true,
    sectionId: "alliance",
  },

  // Alliance > People
  {
    id: "members",
    labelKey: "members",
    href: "/members",
    surface: "native",
    context: "app",
    iconKey: "members",
    favoriteable: true,
    familyId: "people",
    sectionId: "alliance",
    descriptionKey: "membersDescription",
  },
  {
    id: "waiting-list",
    labelKey: "waitingList",
    href: "/waiting-list",
    surface: "ashed-only",
    context: "app",
    iconKey: "waitingList",
    favoriteable: true,
    familyId: "people",
    sectionId: "alliance",
  },
  {
    id: "team-work",
    labelKey: "teamWork",
    href: "/team-work",
    surface: "native",
    context: "app",
    iconKey: "teamWork",
    favoriteable: true,
    familyId: "people",
    sectionId: "alliance",
  },
  {
    id: "support-teams",
    labelKey: "supportTeams",
    href: "/support-teams",
    surface: "native",
    context: "app",
    iconKey: "supportTeams",
    favoriteable: true,
    familyId: "people",
    sectionId: "alliance",
  },

  // Alliance > Professions
  {
    id: "professions",
    labelKey: "professions",
    href: "/professions",
    surface: "native",
    context: "app",
    iconKey: "professionsPage",
    favoriteable: true,
    familyId: "professions",
    sectionId: "alliance",
    descriptionKey: "professionsDescription",
  },

  // Alliance > Alliance administration
  {
    id: "alliances",
    labelKey: "alliances",
    href: "/alliances",
    surface: "ashed-only",
    context: "app",
    iconKey: "alliances",
    favoriteable: true,
    familyId: "alliance-admin",
    sectionId: "alliance",
  },
  {
    id: "alliance-tasks",
    labelKey: "allianceTasks",
    href: "/alliance-tasks",
    surface: "ashed-only",
    context: "app",
    iconKey: "allianceTasks",
    favoriteable: true,
    familyId: "alliance-admin",
    sectionId: "alliance",
  },
  {
    id: "merge-manager",
    labelKey: "mergeManager",
    href: "/merge-manager",
    surface: "ashed-only",
    context: "app",
    iconKey: "mergeManager",
    favoriteable: true,
    familyId: "alliance-admin",
    sectionId: "alliance",
  },

  // Alliance > standalone
  {
    id: "time-off",
    labelKey: "timeOff",
    href: "/time-off",
    surface: "native",
    context: "app",
    iconKey: "timeOff",
    favoriteable: true,
    sectionId: "alliance",
    requiredPermission: "time_off:read",
    descriptionKey: "timeOffDescription",
  },
  {
    id: "alliance-settings",
    labelKey: "allianceSettings",
    href: "/settings",
    surface: "native",
    context: "app",
    iconKey: "allianceSettings",
    favoriteable: true,
    sectionId: "alliance",
    descriptionKey: "allianceSettingsDescription",
  },
  {
    id: "team-access",
    labelKey: "team",
    href: "/settings/team",
    surface: "native",
    context: "app",
    iconKey: "team",
    favoriteable: true,
    sectionId: "alliance",
  },

  // Performance > Personal/Alliance stats
  {
    id: "my-vr",
    labelKey: "myVr",
    href: "/my-vr",
    surface: "native",
    context: "app",
    iconKey: "myVr",
    favoriteable: true,
    familyId: "stats",
    sectionId: "performance",
    hideWhenPermission: "members:write",
    requiresAllianceMemberLink: true,
    descriptionKey: "myVrDescription",
  },
  {
    id: "my-thp",
    labelKey: "myThp",
    href: "/my-thp",
    surface: "native",
    context: "app",
    iconKey: "myThp",
    favoriteable: true,
    familyId: "stats",
    sectionId: "performance",
    hideWhenPermission: "members:write",
    requiresAllianceMemberLink: true,
    descriptionKey: "myThpDescription",
  },
  {
    id: "my-kills",
    labelKey: "myKills",
    href: "/my-kills",
    surface: "native",
    context: "app",
    iconKey: "myKills",
    favoriteable: true,
    familyId: "stats",
    sectionId: "performance",
    hideWhenPermission: "members:write",
    requiresAllianceMemberLink: true,
    descriptionKey: "myKillsDescription",
  },
  {
    id: "viral-resistance",
    labelKey: "viralResistance",
    href: "/viral-resistance",
    surface: "native",
    context: "app",
    iconKey: "viralResistance",
    favoriteable: true,
    familyId: "stats",
    sectionId: "performance",
    requiredPermission: "members:write",
    descriptionKey: "viralResistanceDescription",
  },

  // Performance > VS
  {
    id: "vs-performance",
    labelKey: "vsPerformance",
    href: "/vs-performance",
    surface: "hybrid",
    context: "app",
    iconKey: "vsPerformance",
    favoriteable: true,
    familyId: "vs",
    sectionId: "performance",
    requiredPermission: "scores:read",
  },
  {
    id: "reports",
    labelKey: "reports",
    href: "/reports",
    surface: "ashed-only",
    context: "app",
    iconKey: "reports",
    favoriteable: true,
    familyId: "vs",
    sectionId: "performance",
  },

  // Performance > Contributions
  {
    id: "donations",
    labelKey: "donations",
    href: "/donations",
    surface: "ashed-only",
    context: "app",
    iconKey: "donations",
    favoriteable: true,
    familyId: "contributions",
    sectionId: "performance",
  },
  {
    id: "store-spend",
    labelKey: "storeSpend",
    href: "/donations/store-spend",
    surface: "native",
    context: "app",
    iconKey: "storeSpend",
    favoriteable: true,
    familyId: "contributions",
    sectionId: "performance",
    requiredPermission: "members:write",
    descriptionKey: "storeSpendDescription",
  },

  // Performance > standalone
  {
    id: "alliance-exercise",
    labelKey: "allianceExercise",
    href: "/alliance-exercise",
    surface: "ashed-only",
    context: "app",
    iconKey: "allianceExercise",
    favoriteable: true,
    sectionId: "performance",
  },

  // Operations > Trains
  {
    id: "trains",
    labelKey: "trains",
    href: "/trains",
    surface: "native",
    context: "app",
    iconKey: "trainsPage",
    favoriteable: true,
    familyId: "trains",
    sectionId: "operations",
    descriptionKey: "trainsDescription",
  },
  {
    id: "trains-history-import",
    labelKey: "historyImport",
    href: "/trains/history-import",
    surface: "native",
    context: "app",
    iconKey: "historyImport",
    favoriteable: true,
    familyId: "trains",
    sectionId: "operations",
  },

  // Operations > standalone
  {
    id: "battle-plan",
    labelKey: "battlePlan",
    href: "/battle-plan",
    surface: "native",
    context: "app",
    iconKey: "battlePlan",
    favoriteable: true,
    sectionId: "operations",
    requiredPermission: "battle_plan:read",
    descriptionKey: "battlePlanDescription",
  },
  {
    id: "plunder-plan",
    labelKey: "plunderPlan",
    href: "/plunder-plan",
    surface: "native",
    context: "app",
    iconKey: "plunderPlan",
    favoriteable: true,
    sectionId: "operations",
    requiredPermission: "plunder_plan:read",
  },
  {
    id: "bank-management",
    labelKey: "bankManagement",
    href: "/bank-management",
    surface: "native",
    context: "app",
    iconKey: "bankManagement",
    favoriteable: true,
    sectionId: "operations",
    requiredPermission: "bank:read",
    descriptionKey: "bankManagementDescription",
  },

  // Operations > Events
  {
    id: "event-results",
    labelKey: "eventResults",
    href: "/events",
    surface: "native",
    context: "app",
    iconKey: "eventResults",
    favoriteable: true,
    familyId: "events",
    sectionId: "operations",
    requiredPermission: "events:read",
  },
  {
    id: "desert-storm",
    labelKey: "desertStorm",
    href: "/desert-storm",
    surface: "ashed-only",
    context: "app",
    iconKey: "desertStorm",
    favoriteable: true,
    familyId: "events",
    sectionId: "operations",
  },
  {
    id: "canyon-storm",
    labelKey: "canyonStorm",
    href: "/canyon-storm",
    surface: "ashed-only",
    context: "app",
    iconKey: "canyonStorm",
    favoriteable: true,
    familyId: "events",
    sectionId: "operations",
  },
  {
    id: "other-events",
    labelKey: "otherEvents",
    href: "/seasonal-events",
    surface: "ashed-only",
    context: "app",
    iconKey: "otherEvents",
    favoriteable: true,
    familyId: "events",
    sectionId: "operations",
    ashedPath: "/otherevents",
  },
  {
    id: "zombie-siege",
    labelKey: "zombieSiege",
    href: "/zombie-siege",
    surface: "ashed-only",
    context: "app",
    iconKey: "zombieSiege",
    favoriteable: true,
    familyId: "events",
    sectionId: "operations",
  },

  // Operations > standalone
  {
    id: "notes",
    labelKey: "notes",
    href: "/notes",
    surface: "native",
    context: "app",
    iconKey: "notes",
    favoriteable: true,
    sectionId: "operations",
    requiredPermission: "notes:read",
    descriptionKey: "notesDescription",
  },
  {
    id: "officer-intel",
    labelKey: "officerIntel",
    href: "/officer-intel",
    surface: "native",
    context: "app",
    iconKey: "officerIntel",
    favoriteable: true,
    sectionId: "operations",
    requiredPermission: "officer_intel:read",
    descriptionKey: "officerIntelDescription",
  },

  // Tools > Data tools
  {
    id: "data-management",
    labelKey: "dataManagement",
    href: "/data-management",
    surface: "hybrid",
    context: "app",
    iconKey: "dataManagement",
    favoriteable: true,
    familyId: "data-tools",
    sectionId: "tools",
    requiredPermission: "data:read",
  },
  {
    id: "unmatched-names",
    labelKey: "unmatchedNames",
    href: "/unmatched-names",
    surface: "ashed-only",
    context: "app",
    iconKey: "unmatchedNames",
    favoriteable: true,
    familyId: "data-tools",
    sectionId: "tools",
  },

  // Tools > Video tools
  {
    id: "video-upload",
    labelKey: "videoUpload",
    href: "/tools/video-upload",
    surface: "native",
    context: "app",
    iconKey: "videoUpload",
    favoriteable: true,
    familyId: "video-tools",
    sectionId: "tools",
    requiredPermission: "hq:video:enqueue",
    descriptionKey: "videoUploadDescription",
  },
  {
    id: "video-queue",
    labelKey: "videoQueue",
    href: "/tools/video-upload/queue",
    surface: "native",
    context: "app",
    iconKey: "videoQueue",
    favoriteable: true,
    familyId: "video-tools",
    sectionId: "tools",
  },
  {
    id: "video-processors",
    labelKey: "videoProcessors",
    href: "/tools/video-processors",
    surface: "native",
    context: "app",
    iconKey: "videoProcessors",
    favoriteable: true,
    familyId: "video-tools",
    sectionId: "tools",
    descriptionKey: "videoProcessorsDescription",
  },
  {
    id: "video-jobs-ops",
    labelKey: "videoJobsOps",
    href: "/tools/video-jobs",
    surface: "native",
    context: "app",
    iconKey: "videoJobsOps",
    favoriteable: true,
    familyId: "video-tools",
    sectionId: "tools",
  },

  // Tools > standalone
  {
    id: "admin-portal",
    labelKey: "adminPortal",
    href: "/admin",
    surface: "native",
    context: "app",
    iconKey: "adminPortal",
    favoriteable: true,
    sectionId: "tools",
    requiredPermission: "hq:admin",
  },

  // Help > Guides
  {
    id: "getting-started-guide",
    labelKey: "gettingStartedGuide",
    href: "/guides/getting-started",
    surface: "native",
    context: "app",
    iconKey: "gettingStartedGuide",
    favoriteable: true,
    familyId: "guides",
    sectionId: "help",
    descriptionKey: "gettingStartedGuideDescription",
  },
  {
    id: "discord-bot-guide",
    labelKey: "discordBotGuide",
    href: "/guides/discord-bot",
    surface: "native",
    context: "app",
    iconKey: "discordBotGuide",
    favoriteable: true,
    familyId: "guides",
    sectionId: "help",
    descriptionKey: "discordBotGuideDescription",
  },
  {
    id: "discord-train-guide",
    labelKey: "discordTrainGuide",
    href: "/guides/discord-train",
    surface: "native",
    context: "app",
    iconKey: "discordTrainGuide",
    favoriteable: true,
    familyId: "guides",
    sectionId: "help",
    descriptionKey: "discordTrainGuideDescription",
  },
  {
    id: "alliance-onboarding-guide",
    labelKey: "allianceOnboardingGuide",
    href: "/guides/alliance-onboarding",
    surface: "native",
    context: "app",
    iconKey: "allianceOnboardingGuide",
    favoriteable: true,
    familyId: "guides",
    sectionId: "help",
    descriptionKey: "allianceOnboardingGuideDescription",
  },
];

export const ADMIN_NAV_DESTINATIONS: NavDestination[] = [
  // Admin overview
  {
    id: "admin-overview",
    labelKey: "overview",
    href: "/admin",
    surface: "native",
    context: "admin",
    iconKey: "adminOverviewPage",
    favoriteable: true,
    sectionId: "admin-overview",
  },

  // Support operations
  {
    id: "admin-inbox",
    labelKey: "inbox",
    href: "/admin/inbox",
    surface: "native",
    context: "admin",
    iconKey: "opsInbox",
    favoriteable: true,
    familyId: "admin-support",
    sectionId: "admin-support",
  },
  {
    id: "admin-alliance-setup-requests",
    labelKey: "allianceSetupRequests",
    href: "/admin/alliance-setup-requests",
    surface: "native",
    context: "admin",
    iconKey: "allianceSetupRequests",
    favoriteable: true,
    familyId: "admin-support",
    sectionId: "admin-support",
  },
  {
    id: "admin-member-link-help",
    labelKey: "memberLinkHelp",
    href: "/admin/member-link-help",
    surface: "native",
    context: "admin",
    iconKey: "memberLinkHelp",
    favoriteable: true,
    familyId: "admin-support",
    sectionId: "admin-support",
  },
  {
    id: "admin-uid-inspector",
    labelKey: "uidInspector",
    href: "/admin/uid-inspector",
    surface: "native",
    context: "admin",
    iconKey: "uidInspector",
    favoriteable: true,
    familyId: "admin-support",
    sectionId: "admin-support",
  },

  // Organizations & people
  {
    id: "admin-alliances",
    labelKey: "alliances",
    href: "/admin/alliances",
    surface: "native",
    context: "admin",
    iconKey: "adminAlliances",
    favoriteable: true,
    familyId: "admin-orgs",
    sectionId: "admin-orgs",
  },
  {
    id: "admin-users",
    labelKey: "users",
    href: "/admin/users",
    surface: "native",
    context: "admin",
    iconKey: "hqUsers",
    favoriteable: true,
    familyId: "admin-orgs",
    sectionId: "admin-orgs",
  },
  {
    id: "admin-commanders",
    labelKey: "commanders",
    href: "/admin/commanders",
    surface: "native",
    context: "admin",
    iconKey: "commanders",
    favoriteable: true,
    familyId: "admin-orgs",
    sectionId: "admin-orgs",
  },
  {
    id: "admin-commendations",
    labelKey: "commendations",
    href: "/admin/commendations",
    surface: "native",
    context: "admin",
    iconKey: "commendations",
    favoriteable: true,
    familyId: "admin-orgs",
    sectionId: "admin-orgs",
  },

  // Video pipeline
  {
    id: "admin-video-jobs",
    labelKey: "videoJobs",
    href: "/admin/video-jobs",
    surface: "native",
    context: "admin",
    iconKey: "videoJobs",
    favoriteable: true,
    familyId: "admin-video",
    sectionId: "admin-video",
  },
  {
    id: "admin-video-analytics",
    labelKey: "videoJobAnalytics",
    href: "/admin/video-jobs/analytics",
    surface: "native",
    context: "admin",
    iconKey: "videoJobAnalytics",
    favoriteable: true,
    familyId: "admin-video",
    sectionId: "admin-video",
  },
  {
    id: "admin-parse-configs",
    labelKey: "parseConfigs",
    href: "/admin/parse-configs",
    surface: "native",
    context: "admin",
    iconKey: "parseConfigs",
    favoriteable: true,
    familyId: "admin-video",
    sectionId: "admin-video",
  },
  {
    id: "admin-vs-inventory-items",
    labelKey: "vsInventoryItems",
    href: "/admin/vs-inventory-items",
    surface: "native",
    context: "admin",
    iconKey: "vsInventoryItems",
    favoriteable: true,
    familyId: "admin-video",
    sectionId: "admin-video",
  },

  // Product quality
  {
    id: "admin-experiments",
    labelKey: "experiments",
    href: "/admin/experiments",
    surface: "native",
    context: "admin",
    iconKey: "experiments",
    favoriteable: true,
    familyId: "admin-quality",
    sectionId: "admin-quality",
  },
  {
    id: "admin-bug-reports",
    labelKey: "bugReports",
    href: "/admin/bug-reports",
    surface: "native",
    context: "admin",
    iconKey: "bugReports",
    favoriteable: true,
    familyId: "admin-quality",
    sectionId: "admin-quality",
  },
  {
    id: "admin-experience-feedback",
    labelKey: "experienceFeedback",
    href: "/admin/experience-feedback",
    surface: "native",
    context: "admin",
    iconKey: "experienceFeedback",
    favoriteable: true,
    familyId: "admin-quality",
    sectionId: "admin-quality",
  },
  {
    id: "admin-translation-reports",
    labelKey: "translationReports",
    href: "/admin/translation-reports",
    surface: "native",
    context: "admin",
    iconKey: "translationReports",
    favoriteable: true,
    familyId: "admin-quality",
    sectionId: "admin-quality",
  },

  // Platform
  {
    id: "admin-system",
    labelKey: "system",
    href: "/admin/system",
    surface: "native",
    context: "admin",
    iconKey: "system",
    favoriteable: true,
    familyId: "admin-platform",
    sectionId: "admin-platform",
  },
  {
    id: "admin-game-seasons",
    labelKey: "gameSeasons",
    href: "/admin/game-seasons",
    surface: "native",
    context: "admin",
    iconKey: "gameSeasons",
    favoriteable: true,
    familyId: "admin-platform",
    sectionId: "admin-platform",
  },
  {
    id: "admin-hq-events",
    labelKey: "hqEvents",
    href: "/admin/hq-events",
    surface: "native",
    context: "admin",
    iconKey: "hqEvents",
    favoriteable: true,
    familyId: "admin-platform",
    sectionId: "admin-platform",
  },
  {
    id: "admin-audit",
    labelKey: "audit",
    href: "/admin/audit",
    surface: "native",
    context: "admin",
    iconKey: "audit",
    favoriteable: true,
    familyId: "admin-platform",
    sectionId: "admin-platform",
  },

  // Platform activity
  {
    id: "admin-activity",
    labelKey: "activity",
    href: "/admin/activity",
    surface: "native",
    context: "admin",
    iconKey: "adminActivity",
    favoriteable: true,
    familyId: "admin-platform",
    sectionId: "admin-platform",
  },

  // Back to HQ (not favoriteable, not a real destination for recents)
  {
    id: "back-to-hq",
    labelKey: "backToAllianceHq",
    href: "/dashboard",
    surface: "native",
    context: "admin",
    iconKey: "backToAllianceHq",
    favoriteable: false,
    sectionId: "admin-platform",
  },
];

export const ALL_DESTINATIONS: NavDestination[] = [
  ...APP_NAV_DESTINATIONS,
  ...ADMIN_NAV_DESTINATIONS,
];

export function destinationById(id: string): NavDestination | undefined {
  return ALL_DESTINATIONS.find((d) => d.id === id);
}

export function destinationByHref(href: string): NavDestination | undefined {
  return ALL_DESTINATIONS.find((d) => d.href === href);
}

export function familyById(
  id: string,
  context: NavContext = "app",
): NavFamily | undefined {
  const source = context === "admin" ? ADMIN_NAV_FAMILIES : APP_NAV_FAMILIES;
  return source.find((f) => f.id === id);
}

export function sectionById(
  id: string,
  context: NavContext = "app",
): NavSection | undefined {
  const source = context === "admin" ? ADMIN_NAV_SECTIONS : APP_NAV_SECTIONS;
  return source.find((s) => s.id === id);
}

/** Ashed SPA paths: take HQ kebab-case and remove hyphens. */
export function trainwreckCase(hqPath: string): string {
  const segment = hqPath.replace(/^\//, "").replace(/-/g, "");
  return `/${segment}`;
}

export function resolveAshedPath(destination: NavDestination): string | undefined {
  if (destination.surface !== "ashed-only" && destination.surface !== "hybrid") {
    return undefined;
  }
  return destination.ashedPath ?? trainwreckCase(destination.href);
}

export type NavVisibilityOptions = {
  permissions: ReadonlySet<string> | readonly string[];
  hasAllianceMemberLink: boolean;
  operatingMode: "ashed" | "native" | null;
  canUseAshedEmbeds: boolean;
  showAshedPages: boolean;
  showVideoQueue: boolean;
  showVideoJobsOps: boolean;
  showVideoProcessorsNav: boolean;
  showTeamAccess: boolean;
  showAdminPortal: boolean;
  isPlatformMaintainer: boolean;
};

function permissionSet(
  permissions: ReadonlySet<string> | readonly string[],
): Set<string> {
  return permissions instanceof Set ? new Set(permissions) : new Set(permissions);
}

export function destinationIsVisible(
  destination: NavDestination,
  options: NavVisibilityOptions,
): boolean {
  const perms = permissionSet(options.permissions);

  if (destination.context === "admin" && !perms.has("hq:admin")) {
    return false;
  }

  if (destination.context === "app" && destination.id === "team-access") {
    if (!options.showTeamAccess) {
      return false;
    }
  }

  if (destination.context === "app" && destination.id === "admin-portal") {
    if (!options.showAdminPortal) {
      return false;
    }
  }

  if (destination.id === "video-queue") {
    return options.showVideoQueue;
  }
  if (destination.id === "video-jobs-ops") {
    return options.showVideoJobsOps;
  }
  if (destination.id === "video-processors") {
    return options.showVideoProcessorsNav;
  }

  if (destination.hideWhenPermission && perms.has(destination.hideWhenPermission)) {
    return false;
  }

  if (destination.requiredPermission && !perms.has(destination.requiredPermission)) {
    return false;
  }

  if (
    destination.requiresAllianceMemberLink &&
    !options.hasAllianceMemberLink
  ) {
    return false;
  }

  if (destination.surface === "ashed-only") {
    if (options.operatingMode === "native") {
      return false;
    }
    if (!options.canUseAshedEmbeds || !options.showAshedPages) {
      return false;
    }
  }

  // Hybrid destinations are HQ pages with an optional Ashed pane. The page
  // decides whether that pane renders, so native alliances and the Ashed
  // toggle keep the destination in the nav.
  return true;
}

export type VisibleSection = NavSection & {
  families: Array<NavFamily & { destinations: NavDestination[] }>;
  standalone: NavDestination[];
};

export function resolveVisibleAppNav(
  options: NavVisibilityOptions,
): VisibleSection[] {
  const visibleBySection = new Map<string, NavDestination[]>();

  for (const destination of APP_NAV_DESTINATIONS) {
    if (!destinationIsVisible(destination, options)) {
      continue;
    }
    const list = visibleBySection.get(destination.sectionId) ?? [];
    list.push(destination);
    visibleBySection.set(destination.sectionId, list);
  }

  const result: VisibleSection[] = [];

  for (const section of APP_NAV_SECTIONS) {
    const destinations = visibleBySection.get(section.id) ?? [];
    if (destinations.length === 0 && section.id !== "dashboard") {
      continue;
    }

    const familyMap = new Map<string, NavDestination[]>();
    const standalone: NavDestination[] = [];

    for (const destination of destinations) {
      if (destination.familyId) {
        const list = familyMap.get(destination.familyId) ?? [];
        list.push(destination);
        familyMap.set(destination.familyId, list);
      } else {
        standalone.push(destination);
      }
    }

    const families: Array<NavFamily & { destinations: NavDestination[] }> = [];
    for (const family of APP_NAV_FAMILIES.filter((f) => f.sectionId === section.id)) {
      const children = familyMap.get(family.id) ?? [];
      if (children.length > 0) {
        families.push({ ...family, destinations: children });
      }
    }

    result.push({ ...section, families, standalone });
  }

  return result;
}

export function resolveVisibleAdminNav(
  options: Pick<
    NavVisibilityOptions,
    "permissions" | "hasAllianceMemberLink" | "operatingMode" | "canUseAshedEmbeds" | "showAshedPages"
  >,
): VisibleSection[] {
  const fullOptions: NavVisibilityOptions = {
    ...options,
    showVideoQueue: false,
    showVideoJobsOps: true,
    showVideoProcessorsNav: false,
    showTeamAccess: false,
    showAdminPortal: true,
    isPlatformMaintainer: true,
  };

  const visibleBySection = new Map<string, NavDestination[]>();

  for (const destination of ADMIN_NAV_DESTINATIONS) {
    if (!destinationIsVisible(destination, fullOptions)) {
      continue;
    }
    const list = visibleBySection.get(destination.sectionId) ?? [];
    list.push(destination);
    visibleBySection.set(destination.sectionId, list);
  }

  const result: VisibleSection[] = [];

  for (const section of ADMIN_NAV_SECTIONS) {
    const destinations = visibleBySection.get(section.id) ?? [];
    if (destinations.length === 0) {
      continue;
    }

    const familyMap = new Map<string, NavDestination[]>();
    const standalone: NavDestination[] = [];

    for (const destination of destinations) {
      if (destination.familyId) {
        const list = familyMap.get(destination.familyId) ?? [];
        list.push(destination);
        familyMap.set(destination.familyId, list);
      } else {
        standalone.push(destination);
      }
    }

    const families: Array<NavFamily & { destinations: NavDestination[] }> = [];
    for (const family of ADMIN_NAV_FAMILIES.filter((f) => f.sectionId === section.id)) {
      const children = familyMap.get(family.id) ?? [];
      if (children.length > 0) {
        families.push({ ...family, destinations: children });
      }
    }

    result.push({ ...section, families, standalone });
  }

  return result;
}

export function findActiveDestination(
  pathname: string,
  context?: NavContext,
): NavDestination | undefined {
  const pool = context
    ? ALL_DESTINATIONS.filter((destination) => destination.context === context)
    : ALL_DESTINATIONS;
  const sorted = [...pool].sort((a, b) => b.href.length - a.href.length);
  for (const destination of sorted) {
    if (navLinkActive(pathname, destination.href)) {
      return destination;
    }
  }
  return undefined;
}

export function findActiveFamily(
  pathname: string,
  context: NavContext = "app",
): NavFamily | undefined {
  const destination = findActiveDestination(pathname, context);
  if (!destination?.familyId) {
    return undefined;
  }
  return familyById(destination.familyId, context);
}

export function findActiveSection(
  pathname: string,
  context: NavContext = "app",
): NavSection | undefined {
  const destination = findActiveDestination(pathname, context);
  if (!destination) {
    return undefined;
  }
  return sectionById(destination.sectionId, context);
}

export function navLinkActive(pathname: string, href: string): boolean {
  // /admin is shared by the app Admin link and the admin overview.
  // Only an exact pathname match activates it.
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return routeNavLinkActive(pathname, href);
}
