"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_VIDEO_REVIEW_SETTINGS,
  readVideoReviewSettings,
  type VideoReviewSettings,
  writeVideoReviewSettings,
} from "@/lib/video/video-review-settings.shared";

let cachedSettings = DEFAULT_VIDEO_REVIEW_SETTINGS;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): VideoReviewSettings {
  if (typeof window === "undefined") {
    return DEFAULT_VIDEO_REVIEW_SETTINGS;
  }
  return cachedSettings;
}

function refreshFromStorage() {
  cachedSettings = readVideoReviewSettings();
}

if (typeof window !== "undefined") {
  refreshFromStorage();
}

export function useVideoReviewSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, () =>
    DEFAULT_VIDEO_REVIEW_SETTINGS,
  );

  const patchSettings = useCallback((patch: Partial<VideoReviewSettings>) => {
    const next = { ...cachedSettings, ...patch };
    cachedSettings = next;
    writeVideoReviewSettings(next);
    emit();
  }, []);

  return { settings, patchSettings };
}
