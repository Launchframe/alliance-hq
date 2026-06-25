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

/** localStorage key for persisted preview preferences (bump suffix on shape change). */
export const PREVIEW_PREFS_STORAGE_KEY = "hq-video-preview-prefs-v1";

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

export type PreviewPrefs = {
  open: boolean;
  placement: Record<PreviewDeviceClass, PreviewPlacement>;
};

export const DEFAULT_PREVIEW_PREFS: PreviewPrefs = {
  open: false,
  placement: { ...DEFAULT_PLACEMENT },
};

/** Parse persisted prefs defensively, clamping each device's placement. */
export function parsePreviewPrefs(raw: string | null): PreviewPrefs {
  if (!raw) {
    return { open: false, placement: { ...DEFAULT_PLACEMENT } };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PreviewPrefs> | null;
    const placement = (parsed?.placement ?? {}) as Partial<
      Record<PreviewDeviceClass, PreviewPlacement>
    >;
    return {
      open: typeof parsed?.open === "boolean" ? parsed.open : false,
      placement: {
        desktop: clampPlacement("desktop", placement.desktop),
        tablet: clampPlacement("tablet", placement.tablet),
        mobile: clampPlacement("mobile", placement.mobile),
      },
    };
  } catch {
    return { open: false, placement: { ...DEFAULT_PLACEMENT } };
  }
}

export function serializePreviewPrefs(prefs: PreviewPrefs): string {
  return JSON.stringify(prefs);
}
