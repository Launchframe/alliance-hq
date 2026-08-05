"use client";

import { usePreviewLayout } from "@/components/preview/usePreviewLayout";
import { CITY_LIST_PREVIEW_PREFS_STORAGE_KEY } from "@/lib/video/preview-layout";

export function useCityListPreviewLayout() {
  return usePreviewLayout(CITY_LIST_PREVIEW_PREFS_STORAGE_KEY);
}
