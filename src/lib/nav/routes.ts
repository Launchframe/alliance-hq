export type NavRouteKind = "native" | "ashed" | "external";

export type NavRoute = {
  href: string;
  label: string;
  kind: NavRouteKind;
  ashedPath?: string;
  externalUrl?: string;
  description?: string;
};

export const NAV_ROUTES: NavRoute[] = [
  {
    href: "/",
    label: "Dashboard",
    kind: "native",
    description: "Overview and recent activity",
  },
  {
    href: "/tools/video-upload",
    label: "Upload from video",
    kind: "native",
    description: "Extract scoreboard screenshots from a screen recording",
  },
  {
    href: "/ashed/reports",
    label: "Reports",
    kind: "ashed",
    ashedPath: "/reports",
  },
  {
    href: "/ashed/members",
    label: "Members",
    kind: "ashed",
    ashedPath: "/members",
  },
  {
    href: "/ashed/violations",
    label: "Violations",
    kind: "ashed",
    ashedPath: "/violations",
  },
  {
    href: "https://ashed.online",
    label: "Open Ashed",
    kind: "external",
    externalUrl: "https://ashed.online",
  },
  {
    href: "/settings",
    label: "Settings",
    kind: "native",
  },
];

export const ASHED_ORIGIN = "https://ashed.online";

export function ashedUrlForPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${ASHED_ORIGIN}${normalized}`;
}
