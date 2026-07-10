export const HYBRID_ASHED_PAGES = {
  members: {
    hqHref: "/members",
    ashedPath: "/members",
    labelKey: "members",
  },
  dataManagement: {
    hqHref: "/data-management",
    ashedPath: "/datamanagement",
    labelKey: "dataManagement",
  },
  dashboard: {
    hqHref: "/dashboard",
    ashedPath: "/dashboard",
    labelKey: "dashboard",
  },
} as const;

export type HybridAshedPageId = keyof typeof HYBRID_ASHED_PAGES;
