"use client";

import { usePreviewLayout, type PreviewLayout } from "@/components/preview/usePreviewLayout";
import { VIDEO_PREVIEW_PREFS_STORAGE_KEY } from "@/lib/video/preview-layout";

export type VideoPreviewLayout = Omit<
  PreviewLayout,
  "getImageTransform" | "setImageTransform"
>;

/**
 * Resolve and persist the review video-preview layout. Device class is derived
 * from the viewport (updates on resize/rotate); placement is stored per device
 * class in localStorage so each form factor keeps its own preference.
 */
export function useVideoPreviewLayout(): VideoPreviewLayout {
  const layout = usePreviewLayout(VIDEO_PREVIEW_PREFS_STORAGE_KEY);
  // Video review does not expose per-screenshot image transforms.
  const {
    getImageTransform: _getImageTransform,
    setImageTransform: _setImageTransform,
    ...videoLayout
  } = layout;
  void _getImageTransform;
  void _setImageTransform;
  return videoLayout;
}
