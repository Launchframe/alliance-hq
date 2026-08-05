"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  availablePlacements,
  clampPlacement,
  clampDockHeightPx,
  clampPreviewImageTransform,
  clampPreviewSize,
  clampSideWidthPx,
  DEFAULT_PREVIEW_IMAGE_TRANSFORM,
  deviceClassForWidth,
  nextViewportSnapshot,
  parsePreviewPrefs,
  serializePreviewPrefs,
  DEFAULT_PREVIEW_PREFS,
  type PreviewDeviceClass,
  type PreviewImageTransform,
  type PreviewPlacement,
  type PreviewPrefs,
  type PreviewZoom,
  type Viewport,
} from "@/lib/video/preview-layout";

export type PreviewLayout = {
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
  getImageTransform: (screenshotId: string) => PreviewImageTransform;
  setImageTransform: (
    screenshotId: string,
    transform: PreviewImageTransform,
  ) => void;
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

let viewportCache: Viewport = { width: 0, height: 0 };

function getViewportSnapshot(): Viewport {
  viewportCache = nextViewportSnapshot(
    viewportCache,
    window.innerWidth,
    window.innerHeight,
  );
  return viewportCache;
}

const SERVER_VIEWPORT: Viewport = { width: 390, height: 844 };

function getViewportServerSnapshot(): Viewport {
  return SERVER_VIEWPORT;
}

// --- Preferences external store (localStorage-backed, per storage key) ------

type PrefsStore = {
  cache: PreviewPrefs | null;
  viewport: Viewport | null;
  listeners: Set<() => void>;
};

const prefsStores = new Map<string, PrefsStore>();

function getPrefsStore(storageKey: string): PrefsStore {
  let store = prefsStores.get(storageKey);
  if (!store) {
    store = { cache: null, viewport: null, listeners: new Set() };
    prefsStores.set(storageKey, store);
  }
  return store;
}

function readPrefs(storageKey: string, viewport: Viewport): PreviewPrefs {
  const store = getPrefsStore(storageKey);
  if (store.cache && store.viewport) {
    const sameViewport =
      store.viewport.width === viewport.width &&
      store.viewport.height === viewport.height;
    if (sameViewport) return store.cache;
  }
  store.viewport = viewport;
  store.cache = parsePreviewPrefs(
    window.localStorage.getItem(storageKey),
    viewport,
  );
  return store.cache;
}

function writePrefs(
  storageKey: string,
  next: PreviewPrefs,
  viewport: Viewport,
): void {
  const store = getPrefsStore(storageKey);
  store.cache = next;
  store.viewport = viewport;
  try {
    window.localStorage.setItem(storageKey, serializePreviewPrefs(next));
  } catch {
    // ignore quota / privacy-mode write failures
  }
  for (const listener of store.listeners) listener();
}

function subscribePrefs(
  storageKey: string,
  onChange: () => void,
): () => void {
  const store = getPrefsStore(storageKey);
  store.listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) {
      store.cache = null;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    store.listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getPrefsSnapshot(
  storageKey: string,
  viewport: Viewport,
): PreviewPrefs {
  return readPrefs(storageKey, viewport);
}

function getPrefsServerSnapshot(): PreviewPrefs {
  return DEFAULT_PREVIEW_PREFS;
}

/**
 * Resolve and persist a review preview layout. Device class is derived from the
 * viewport; placement and pane size are stored per device class in localStorage.
 */
export function usePreviewLayout(storageKey: string): PreviewLayout {
  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  );
  const device = deviceClassForWidth(viewport.width);
  const prefs = useSyncExternalStore(
    (onChange) => subscribePrefs(storageKey, onChange),
    () => getPrefsSnapshot(storageKey, viewport),
    getPrefsServerSnapshot,
  );

  const resolvedSize = clampPreviewSize(prefs.size[device], viewport);

  const setOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) => {
      const current = readPrefs(storageKey, viewport);
      const open = typeof next === "function" ? next(current.open) : next;
      writePrefs(storageKey, { ...current, open }, viewport);
    },
    [storageKey, viewport],
  );

  const setPlacement = useCallback(
    (placement: PreviewPlacement) => {
      const current = readPrefs(storageKey, viewport);
      writePrefs(
        storageKey,
        {
          ...current,
          placement: { ...current.placement, [device]: placement },
        },
        viewport,
      );
    },
    [device, storageKey, viewport],
  );

  const setZoom = useCallback(
    (next: PreviewZoom | ((zoom: PreviewZoom) => PreviewZoom)) => {
      const current = readPrefs(storageKey, viewport);
      const zoom = typeof next === "function" ? next(current.zoom) : next;
      writePrefs(storageKey, { ...current, zoom }, viewport);
    },
    [storageKey, viewport],
  );

  const setSideWidthPx = useCallback(
    (width: number) => {
      const current = readPrefs(storageKey, viewport);
      const nextWidth = clampSideWidthPx(width, viewport.width);
      writePrefs(
        storageKey,
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
    [device, storageKey, viewport],
  );

  const setDockHeightPx = useCallback(
    (height: number) => {
      const current = readPrefs(storageKey, viewport);
      const nextHeight = clampDockHeightPx(height, viewport.height);
      writePrefs(
        storageKey,
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
    [device, storageKey, viewport],
  );

  const setFollowMe = useCallback(
    (next: boolean | ((followMe: boolean) => boolean)) => {
      const current = readPrefs(storageKey, viewport);
      const followMe =
        typeof next === "function" ? next(current.followMe) : next;
      writePrefs(storageKey, { ...current, followMe }, viewport);
    },
    [storageKey, viewport],
  );

  const getImageTransform = useCallback(
    (screenshotId: string): PreviewImageTransform => {
      const current = readPrefs(storageKey, viewport);
      return (
        current.imageTransforms[screenshotId] ?? DEFAULT_PREVIEW_IMAGE_TRANSFORM
      );
    },
    [storageKey, viewport],
  );

  const setImageTransform = useCallback(
    (screenshotId: string, transform: PreviewImageTransform) => {
      const current = readPrefs(storageKey, viewport);
      writePrefs(
        storageKey,
        {
          ...current,
          imageTransforms: {
            ...current.imageTransforms,
            [screenshotId]: clampPreviewImageTransform(transform),
          },
        },
        viewport,
      );
    },
    [storageKey, viewport],
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
    getImageTransform,
    setImageTransform,
  };
}
