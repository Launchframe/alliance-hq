/**
 * Layout model for the video review source-preview pane.
 *
 * The preview can be docked in three ways depending on available room:
 *  - "side":   sticky column beside the data (desktop / tablet landscape room)
 *  - "top":    sticky bar pinned to the top of the viewport
 *  - "bottom": fixed bar pinned to the bottom of the viewport
 *
 * Which placements are offered depends on the device class, and the chosen
 * placement is remembered per device class so phones, tablets, and desktops can
 * each keep a sensible default without fighting each other.
 */

export type PreviewPlacement = "side" | "top" | "bottom";
export type PreviewDeviceClass = "mobile" | "tablet" | "desktop";

/**
 * How the (typically portrait) source video is scaled inside the pane:
 *  - "fit":   whole frame letterboxed within the pane (object-contain)
 *  - "width": frame scaled so its width fills the pane; the pane scrolls
 *             vertically. Lets portrait leaderboards read at full row width in
 *             the short top/bottom docks.
 */
export type PreviewZoom = "fit" | "width";

const PREVIEW_ZOOMS: readonly PreviewZoom[] = ["fit", "width"];

/** localStorage key for persisted preview preferences (bump suffix on shape change). */
export const PREVIEW_PREFS_STORAGE_KEY = "hq-video-preview-prefs-v2";

/** Tailwind breakpoints: tablet >= md (768px), desktop >= lg (1024px). */
export function deviceClassForWidth(width: number): PreviewDeviceClass {
  if (width >= 1024) return "desktop";
  if (width >= 768) return "tablet";
  return "mobile";
}

/** Placements a device class is wide/tall enough to offer, in display order. */
export function availablePlacements(
  device: PreviewDeviceClass,
): PreviewPlacement[] {
  switch (device) {
    case "desktop":
      return ["side"];
    case "tablet":
      return ["side", "top", "bottom"];
    case "mobile":
    default:
      return ["top", "bottom"];
  }
}

export const DEFAULT_PLACEMENT: Record<PreviewDeviceClass, PreviewPlacement> = {
  desktop: "side",
  tablet: "side",
  mobile: "bottom",
};

/** Coerce a (possibly stale/invalid) placement into one valid for the device. */
export function clampPlacement(
  device: PreviewDeviceClass,
  placement: PreviewPlacement | undefined | null,
): PreviewPlacement {
  const allowed = availablePlacements(device);
  if (placement && allowed.includes(placement)) {
    return placement;
  }
  return DEFAULT_PLACEMENT[device];
}

export type PreviewPaneSize = {
  sideWidthPx: number;
  dockHeightPx: number;
};

/** Default side column width: min(45vw, 26rem). */
export function defaultSideWidthPx(viewportWidth: number): number {
  return Math.round(Math.min(viewportWidth * 0.45, 416));
}

/** Default top/bottom dock height: 42dvh. */
export function defaultDockHeightPx(viewportHeight: number): number {
  return Math.round(viewportHeight * 0.42);
}

export function clampSideWidthPx(
  width: number,
  viewportWidth: number,
): number {
  const max = Math.round(viewportWidth * 0.7);
  return Math.max(256, Math.min(max, Math.round(width)));
}

export function clampDockHeightPx(
  height: number,
  viewportHeight: number,
): number {
  const min = Math.round(viewportHeight * 0.2);
  const max = Math.round(viewportHeight * 0.8);
  return Math.max(min, Math.min(max, Math.round(height)));
}

export function clampPreviewSize(
  size: Partial<PreviewPaneSize> | undefined | null,
  viewport: { width: number; height: number },
): PreviewPaneSize {
  return {
    sideWidthPx: clampSideWidthPx(
      size?.sideWidthPx ?? defaultSideWidthPx(viewport.width),
      viewport.width,
    ),
    dockHeightPx: clampDockHeightPx(
      size?.dockHeightPx ?? defaultDockHeightPx(viewport.height),
      viewport.height,
    ),
  };
}

export type PreviewPrefs = {
  open: boolean;
  placement: Record<PreviewDeviceClass, PreviewPlacement>;
  zoom: PreviewZoom;
  size: Record<PreviewDeviceClass, PreviewPaneSize>;
};

const FALLBACK_VIEWPORT = { width: 1280, height: 800 };

export const DEFAULT_PREVIEW_PREFS: PreviewPrefs = {
  open: true,
  placement: { ...DEFAULT_PLACEMENT },
  zoom: "fit",
  size: {
    desktop: clampPreviewSize(null, FALLBACK_VIEWPORT),
    tablet: clampPreviewSize(null, FALLBACK_VIEWPORT),
    mobile: clampPreviewSize(null, { width: 390, height: 844 }),
  },
};

/** Coerce a (possibly stale/invalid) zoom into a known value. */
export function clampZoom(zoom: PreviewZoom | undefined | null): PreviewZoom {
  return zoom && PREVIEW_ZOOMS.includes(zoom) ? zoom : "fit";
}

function parseStoredSize(
  raw: Partial<PreviewPaneSize> | undefined | null,
  viewport: { width: number; height: number },
): PreviewPaneSize {
  return clampPreviewSize(raw, viewport);
}

/** Parse persisted prefs defensively, clamping each device's placement. */
export function parsePreviewPrefs(
  raw: string | null,
  viewport: { width: number; height: number } = FALLBACK_VIEWPORT,
): PreviewPrefs {
  if (!raw) {
    return {
      open: true,
      placement: { ...DEFAULT_PLACEMENT },
      zoom: "fit",
      size: {
        desktop: clampPreviewSize(null, viewport),
        tablet: clampPreviewSize(null, viewport),
        mobile: clampPreviewSize(null, viewport),
      },
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PreviewPrefs> | null;
    const placement = (parsed?.placement ?? {}) as Partial<
      Record<PreviewDeviceClass, PreviewPlacement>
    >;
    const size = (parsed?.size ?? {}) as Partial<
      Record<PreviewDeviceClass, Partial<PreviewPaneSize>>
    >;
    return {
      open: typeof parsed?.open === "boolean" ? parsed.open : true,
      placement: {
        desktop: clampPlacement("desktop", placement.desktop),
        tablet: clampPlacement("tablet", placement.tablet),
        mobile: clampPlacement("mobile", placement.mobile),
      },
      zoom: clampZoom(parsed?.zoom),
      size: {
        desktop: parseStoredSize(size.desktop, viewport),
        tablet: parseStoredSize(size.tablet, viewport),
        mobile: parseStoredSize(size.mobile, viewport),
      },
    };
  } catch {
    return parsePreviewPrefs(null, viewport);
  }
}

export function serializePreviewPrefs(prefs: PreviewPrefs): string {
  return JSON.stringify(prefs);
}
