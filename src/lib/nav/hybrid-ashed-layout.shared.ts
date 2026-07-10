export type HybridMobilePane = "hq" | "ashed";

export type HybridDesktopLayout = {
  hqRatio: number;
  hqCollapsed: boolean;
  ashedCollapsed: boolean;
};

export type HybridAshedLayoutPrefs = {
  mobile: { activePane: HybridMobilePane };
  desktop: HybridDesktopLayout;
};

export const HYBRID_ASHED_LAYOUT_VERSION = "v1";
export const DEFAULT_HQ_RATIO = 0.55;
const MIN_HQ_RATIO = 0.25;
const MAX_HQ_RATIO = 0.75;

export function hybridAshedLayoutStorageKey(pageId: string): string {
  return `alliance-hq-hybrid-ashed-${HYBRID_ASHED_LAYOUT_VERSION}:${pageId}`;
}

export const DEFAULT_HYBRID_ASHED_LAYOUT: HybridAshedLayoutPrefs = {
  mobile: { activePane: "hq" },
  desktop: {
    hqRatio: DEFAULT_HQ_RATIO,
    hqCollapsed: false,
    ashedCollapsed: false,
  },
};

export function clampHqRatio(value: number): number {
  return Math.min(MAX_HQ_RATIO, Math.max(MIN_HQ_RATIO, value));
}

function clampRatio(value: unknown): number {
  const num = typeof value === "number" ? value : DEFAULT_HQ_RATIO;
  return clampHqRatio(num);
}

export function parseHybridAshedLayoutPrefs(
  raw: unknown,
): HybridAshedLayoutPrefs {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_HYBRID_ASHED_LAYOUT;
  }

  const record = raw as Record<string, unknown>;
  const mobileRecord =
    record.mobile && typeof record.mobile === "object"
      ? (record.mobile as Record<string, unknown>)
      : null;
  const desktopRecord =
    record.desktop && typeof record.desktop === "object"
      ? (record.desktop as Record<string, unknown>)
      : null;

  const activePane =
    mobileRecord?.activePane === "ashed" ? "ashed" : "hq";

  const desktop: HybridDesktopLayout = {
    hqRatio: clampRatio(desktopRecord?.hqRatio),
    hqCollapsed: desktopRecord?.hqCollapsed === true,
    ashedCollapsed: desktopRecord?.ashedCollapsed === true,
  };

  if (desktop.hqCollapsed && desktop.ashedCollapsed) {
    desktop.hqCollapsed = false;
  }

  return {
    mobile: { activePane },
    desktop,
  };
}

export function serializeHybridAshedLayoutPrefs(
  prefs: HybridAshedLayoutPrefs,
): string {
  return JSON.stringify(prefs);
}
