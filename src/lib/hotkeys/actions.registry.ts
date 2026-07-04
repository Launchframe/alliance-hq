import { ADMIN_LINKS } from "@/lib/admin/nav-links";
import { NAV_GROUPS } from "@/lib/nav/routes";
import type { HotkeyActionDef } from "@/lib/hotkeys/types";

const NATIVE_NAV_HREFS = new Set(
  NAV_GROUPS.flatMap((group) => group.pages)
    .filter((page) => page.kind === "native")
    .map((page) => page.href),
);

const NATIVE_MODE_EXTRA_HREFS = new Set([
  "/settings",
  "/settings/account",
  "/settings/team",
  "/settings/discord",
  "/settings/trains",
  "/settings/upload-reminders",
  "/settings/hotkeys",
  "/tools/video-upload/queue",
  "/inbox",
  "/admin",
  "/connect",
  ...ADMIN_LINKS.map((link) => link.href),
]);

const NAV_ACTIONS: HotkeyActionDef[] = [
  {
    id: "nav.dashboard",
    labelKey: "actions.nav.dashboard",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/dashboard",
  },
  {
    id: "nav.members",
    labelKey: "actions.nav.members",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/members",
  },
  {
    id: "nav.vsPerformance",
    labelKey: "actions.nav.vsPerformance",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/vs-performance",
  },
  {
    id: "nav.donations",
    labelKey: "actions.nav.donations",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/donations",
  },
  {
    id: "nav.allianceExercise",
    labelKey: "actions.nav.allianceExercise",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/alliance-exercise",
  },
  {
    id: "nav.reports",
    labelKey: "actions.nav.reports",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/reports",
  },
  {
    id: "nav.viralResistance",
    labelKey: "actions.nav.viralResistance",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/viral-resistance",
    requiredPermission: "members:write",
  },
  {
    id: "nav.myVr",
    labelKey: "actions.nav.myVr",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/my-vr",
    hideWhenPermission: "members:write",
  },
  {
    id: "nav.trains",
    labelKey: "actions.nav.trains",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/trains",
  },
  {
    id: "nav.desertStorm",
    labelKey: "actions.nav.desertStorm",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/desert-storm",
  },
  {
    id: "nav.canyonStorm",
    labelKey: "actions.nav.canyonStorm",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/canyon-storm",
  },
  {
    id: "nav.otherEvents",
    labelKey: "actions.nav.otherEvents",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/seasonal-events",
  },
  {
    id: "nav.zombieSiege",
    labelKey: "actions.nav.zombieSiege",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/zombie-siege",
  },
  {
    id: "nav.dataManagement",
    labelKey: "actions.nav.dataManagement",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/data-management",
  },
  {
    id: "nav.videoUpload",
    labelKey: "actions.nav.videoUpload",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/tools/video-upload",
    requiredPermission: "hq:video:enqueue",
  },
  {
    id: "nav.videoQueue",
    labelKey: "actions.nav.videoQueue",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/tools/video-upload/queue",
    requiredPermission: "hq:video:read",
  },
  {
    id: "nav.reminders",
    labelKey: "actions.nav.reminders",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/inbox",
    requiredPermission: "inbox:read",
  },
  {
    id: "nav.adminPortal",
    labelKey: "actions.nav.adminPortal",
    category: "navigation",
    scope: "global",
    kind: "admin-sequence-start",
    href: "/admin",
    requiredPermission: "hq:admin",
  },
  {
    id: "nav.opsInbox",
    labelKey: "actions.nav.opsInbox",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/admin/inbox",
    requiredPermission: "hq:admin",
  },
  {
    id: "nav.account",
    labelKey: "actions.nav.account",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/settings/account",
  },
  {
    id: "nav.settings",
    labelKey: "actions.nav.settings",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/settings",
  },
  {
    id: "nav.discordBotGuide",
    labelKey: "actions.nav.discordBotGuide",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/guides/discord-bot",
  },
  {
    id: "nav.discordTrainGuide",
    labelKey: "actions.nav.discordTrainGuide",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/guides/discord-train",
  },
  {
    id: "nav.allianceOnboardingGuide",
    labelKey: "actions.nav.allianceOnboardingGuide",
    category: "navigation",
    scope: "global",
    kind: "navigate",
    href: "/guides/alliance-onboarding",
  },
];

const ADMIN_SEQUENCE_KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
] as const;

const ADMIN_ACTIONS: HotkeyActionDef[] = ADMIN_LINKS.map((link, index) => ({
  id: `admin.nav.${link.labelKey}`,
  labelKey: `actions.admin.${link.labelKey}`,
  category: "admin" as const,
  scope: "admin-sequence" as const,
  kind: "navigate" as const,
  href: link.href,
  requiredPermission: "hq:admin",
  adminSequenceKey: ADMIN_SEQUENCE_KEYS[index] ?? `x${index}`,
}));

const TRAIN_ACTIONS: HotkeyActionDef[] = [
  {
    id: "trains.spinWheel",
    labelKey: "actions.trains.spinWheel",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "trains:write",
  },
  {
    id: "trains.spinWeek",
    labelKey: "actions.trains.spinWeek",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "trains:write",
  },
  {
    id: "trains.spinVip",
    labelKey: "actions.trains.spinVip",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "trains:write",
  },
  {
    id: "trains.pickConductor",
    labelKey: "actions.trains.pickConductor",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "trains:write",
  },
  {
    id: "trains.pickVip",
    labelKey: "actions.trains.pickVip",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "trains:write",
  },
  {
    id: "trains.lockConductor",
    labelKey: "actions.trains.lockConductor",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "trains:write",
  },
  {
    id: "trains.viewPool",
    labelKey: "actions.trains.viewPool",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "scores:read",
  },
  {
    id: "trains.scheduleWeek",
    labelKey: "actions.trains.scheduleWeek",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "scores:read",
  },
  {
    id: "trains.scheduleMonth",
    labelKey: "actions.trains.scheduleMonth",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "scores:read",
  },
  {
    id: "trains.goToToday",
    labelKey: "actions.trains.goToToday",
    category: "trains",
    scope: "page:trains",
    kind: "custom",
    requiredPermission: "scores:read",
  },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `trains.template.${index + 1}` as const,
    labelKey: `actions.trains.template${index + 1}` as const,
    category: "trains" as const,
    scope: "page:trains" as const,
    kind: "custom" as const,
    requiredPermission: "trains:write",
  })),
];

const GLOBAL_ACTIONS: HotkeyActionDef[] = [
  {
    id: "global.openPalette",
    labelKey: "actions.global.openPalette",
    category: "global",
    scope: "global",
    kind: "open-palette",
  },
  {
    id: "global.openHotkeyReference",
    labelKey: "actions.global.openHotkeyReference",
    category: "global",
    scope: "global",
    kind: "open-hotkey-reference",
  },
  {
    id: "global.focusSidebar",
    labelKey: "actions.global.focusSidebar",
    category: "global",
    scope: "global",
    kind: "focus-sidebar",
  },
  {
    id: "global.connectAshed",
    labelKey: "actions.global.connectAshed",
    category: "global",
    scope: "global",
    kind: "connect-ashed",
    href: "/connect",
    requiresDisconnected: true,
  },
];

export const HOTKEY_ACTIONS: HotkeyActionDef[] = [
  ...GLOBAL_ACTIONS,
  ...NAV_ACTIONS,
  ...ADMIN_ACTIONS,
  ...TRAIN_ACTIONS,
];

export type HotkeyActionId = (typeof HOTKEY_ACTIONS)[number]["id"];

export const HOTKEY_ACTIONS_BY_ID = new Map(
  HOTKEY_ACTIONS.map((action) => [action.id, action]),
);

export function getHotkeyAction(actionId: string): HotkeyActionDef | undefined {
  return HOTKEY_ACTIONS_BY_ID.get(actionId);
}

export function isHotkeyActionAllowed(
  action: HotkeyActionDef,
  permissions: ReadonlySet<string>,
  options: {
    bypassPermissions?: boolean;
    isConnected?: boolean;
    operatingMode?: "ashed" | "native" | null;
    showVideoQueue?: boolean;
  } = {},
): boolean {
  if (options.bypassPermissions) return true;

  if (
    action.requiredPermission &&
    !permissions.has(action.requiredPermission)
  ) {
    if (action.id === "nav.videoQueue" && options.showVideoQueue) {
      // Video queue may be visible via processor slot without hq:video:read.
    } else {
      return false;
    }
  }

  if (
    action.hideWhenPermission &&
    permissions.has(action.hideWhenPermission)
  ) {
    return false;
  }

  if (action.requiresDisconnected && options.isConnected) {
    return false;
  }

  if (
    options.operatingMode === "native" &&
    action.href &&
    !NATIVE_NAV_HREFS.has(action.href) &&
    !NATIVE_MODE_EXTRA_HREFS.has(action.href)
  ) {
    return false;
  }

  return true;
}

export function listVisibleHotkeyActions(
  permissions: readonly string[],
  options: {
    bypassPermissions?: boolean;
    isConnected?: boolean;
    operatingMode?: "ashed" | "native" | null;
    showVideoQueue?: boolean;
  } = {},
): HotkeyActionDef[] {
  const permissionSet = new Set(permissions);
  return HOTKEY_ACTIONS.filter((action) =>
    isHotkeyActionAllowed(action, permissionSet, options),
  );
}
