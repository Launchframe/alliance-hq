"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  availablePlacements,
  clampPlacement,
  clampDockHeightPx,
  clampPreviewSize,
  clampSideWidthPx,
  deviceClassForWidth,
  nextViewportSnapshot,
  parsePreviewPrefs,
  serializePreviewPrefs,
  DEFAULT_PREVIEW_PREFS,
  PREVIEW_PREFS_STORAGE_KEY,
  type PreviewDeviceClass,
  type PreviewPlacement,
  type PreviewPrefs,
  type PreviewZoom,
  type Viewport,
} from "@/lib/video/preview-layout";

export type VideoPreviewLayout = {
  device: PreviewDeviceClass;
  /** Placement resolved (clamped) for the current device class. */
  placement: PreviewPlacement;
  available: PreviewPlacement[];
  open: boolean;
  zoom: PreviewZoom;
  sideWidthPx: number;
  dockHeightPx: number;
  followMe: boolean;
  setOpen: (next: boolean | ((open: boolean) => boolean)) => void;
  setPlacement: (placement: PreviewPlacement) => void;
  setZoom: (next: PreviewZoom | ((zoom: PreviewZoom) => PreviewZoom)) => void;
  setSideWidthPx: (width: number) => void;
  setDockHeightPx: (height: number) => void;
  setFollowMe: (next: boolean | ((followMe: boolean) => boolean)) => void;
};

// --- Viewport external store -----------------------------------------------

function subscribeViewport(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

// useSyncExternalStore compares snapshots by reference, so the snapshot must be
// referentially stable between renders — nextViewportSnapshot only swaps in a
// new object when the viewport dimensions actually change, otherwise React
// loops forever ("Maximum update depth exceeded").
let viewportCache: Viewport = { width: 0, height: 0 };

function getViewportSnapshot(): Viewport {
  viewportCache = nextViewportSnapshot(
    viewportCache,
    window.innerWidth,
    window.innerHeight,
  );
  return viewportCache;
}

/**
 * Mobile-first SSR snapshot. A desktop-sized server viewport paints the side
 * preview column into the HTML, which phones then show as a half-width page
 * with horizontal scroll until hydration. Prefer a phone-sized default so the
 * first paint matches portrait devices; wide desktops adjust after hydrate.
 */
const SERVER_VIEWPORT: Viewport = { width: 390, height: 844 };

function getViewportServerSnapshot(): Viewport {
  return SERVER_VIEWPORT;
}

// --- Preferences external store (localStorage-backed) ---------------------

let prefsCache: PreviewPrefs | null = null;
let prefsViewport: Viewport | null = null;
const prefsListeners = new Set<() => void>();

function readPrefs(viewport: Viewport): PreviewPrefs {
  if (prefsCache && prefsViewport) {
    const sameViewport =
      prefsViewport.width === viewport.width &&
      prefsViewport.height === viewport.height;
    if (sameViewport) return prefsCache;
  }
  prefsViewport = viewport;
  prefsCache = parsePreviewPrefs(
    window.localStorage.getItem(PREVIEW_PREFS_STORAGE_KEY),
    viewport,
  );
  return prefsCache;
}

function writePrefs(next: PreviewPrefs, viewport: Viewport): void {
  prefsCache = next;
  prefsViewport = viewport;
  try {
    window.localStorage.setItem(
      PREVIEW_PREFS_STORAGE_KEY,
      serializePreviewPrefs(next),
    );
  } catch {
    // ignore quota / privacy-mode write failures
  }
  for (const listener of prefsListeners) listener();
}

function subscribePrefs(onChange: () => void): () => void {
  prefsListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREVIEW_PREFS_STORAGE_KEY) {
      prefsCache = null;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefsListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getPrefsSnapshot(viewport: Viewport): PreviewPrefs {
  return readPrefs(viewport);
}

function getPrefsServerSnapshot(): PreviewPrefs {
  return DEFAULT_PREVIEW_PREFS;
}

/**
 * Resolve and persist the review video-preview layout. Device class is derived
 * from the viewport (updates on resize/rotate); placement is stored per device
 * class in localStorage so each form factor keeps its own preference.
 */
export function useVideoPreviewLayout(): VideoPreviewLayout {
  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  );
  const device = deviceClassForWidth(viewport.width);
  const prefs = useSyncExternalStore(
    subscribePrefs,
    () => getPrefsSnapshot(viewport),
    getPrefsServerSnapshot,
  );

  const resolvedSize = clampPreviewSize(prefs.size[device], viewport);

  const setOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) => {
      const current = readPrefs(viewport);
      const open = typeof next === "function" ? next(current.open) : next;
      writePrefs({ ...current, open }, viewport);
    },
    [viewport],
  );

  const setPlacement = useCallback(
    (placement: PreviewPlacement) => {
      const current = readPrefs(viewport);
      writePrefs(
        {
          ...current,
          placement: { ...current.placement, [device]: placement },
        },
        viewport,
      );
    },
    [device, viewport],
  );

  const setZoom = useCallback(
    (next: PreviewZoom | ((zoom: PreviewZoom) => PreviewZoom)) => {
      const current = readPrefs(viewport);
      const zoom = typeof next === "function" ? next(current.zoom) : next;
      writePrefs({ ...current, zoom }, viewport);
    },
    [viewport],
  );

  const setSideWidthPx = useCallback(
    (width: number) => {
      const current = readPrefs(viewport);
      const nextWidth = clampSideWidthPx(width, viewport.width);
      writePrefs(
        {
          ...current,
          size: {
            ...current.size,
            [device]: {
              ...current.size[device],
              sideWidthPx: nextWidth,
            },
          },
        },
        viewport,
      );
    },
    [device, viewport],
  );

  const setDockHeightPx = useCallback(
    (height: number) => {
      const current = readPrefs(viewport);
      const nextHeight = clampDockHeightPx(height, viewport.height);
      writePrefs(
        {
          ...current,
          size: {
            ...current.size,
            [device]: {
              ...current.size[device],
              dockHeightPx: nextHeight,
            },
          },
        },
        viewport,
      );
    },
    [device, viewport],
  );

  const setFollowMe = useCallback(
    (next: boolean | ((followMe: boolean) => boolean)) => {
      const current = readPrefs(viewport);
      const followMe =
        typeof next === "function" ? next(current.followMe) : next;
      writePrefs({ ...current, followMe }, viewport);
    },
    [viewport],
  );

  return {
    device,
    placement: clampPlacement(device, prefs.placement[device]),
    available: availablePlacements(device),
    open: prefs.open,
    zoom: prefs.zoom,
    sideWidthPx: resolvedSize.sideWidthPx,
    dockHeightPx: resolvedSize.dockHeightPx,
    followMe: prefs.followMe,
    setOpen,
    setPlacement,
    setZoom,
    setSideWidthPx,
    setDockHeightPx,
    setFollowMe,
  };
}
