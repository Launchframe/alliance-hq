export type NavRouteKind = "native" | "ashed" | "external";

export type NavRouteDef = {
  href: string;
  labelKey: string;
  kind: NavRouteKind;
  ashedPath?: string;
  externalUrl?: string;
  descriptionKey?: string;
};

export const NAV_ROUTE_DEFS: NavRouteDef[] = [
  {
    href: "/",
    labelKey: "dashboard",
    kind: "native",
    descriptionKey: "dashboardDescription",
  },
  {
    href: "/tools/video-upload",
    labelKey: "videoUpload",
    kind: "native",
    descriptionKey: "videoUploadDescription",
  },
  {
    href: "/ashed/reports",
    labelKey: "reports",
    kind: "ashed",
    ashedPath: "/reports",
  },
  {
    href: "/ashed/members",
    labelKey: "members",
    kind: "ashed",
    ashedPath: "/members",
  },
  {
    href: "/ashed/violations",
    labelKey: "violations",
    kind: "ashed",
    ashedPath: "/violations",
  },
  {
    href: "https://ashed.online",
    labelKey: "openAshed",
    kind: "external",
    externalUrl: "https://ashed.online",
  },
  {
    href: "/settings",
    labelKey: "settings",
    kind: "native",
  },
];

export const ASHED_ORIGIN = "https://ashed.online";

export function ashedUrlForPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${ASHED_ORIGIN}${normalized}`;
}
