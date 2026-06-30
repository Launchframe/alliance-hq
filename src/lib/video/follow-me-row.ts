import type { PreviewPlacement } from "@/lib/video/preview-layout";

export type CenterDistanceEntry = {
  rowId: string;
  distanceFromCenterPx: number;
};

/**
 * Pick the row whose anchor is closest to the visible band's center.
 *
 * Follow-me tracks the row at the viewport center (what the reviewer is
 * actually looking at), the same way regardless of scroll direction. An earlier
 * implementation picked the leading edge per scroll direction (bottommost when
 * scrolling down, topmost when scrolling up); because the observed anchor sits
 * at the row top and the band's top inset (sticky header) is larger than its
 * bottom inset, the up-scroll leading row sat one row above viewport center and
 * the preview showed a frame one row too early. Center-distance selection is
 * symmetric and avoids that off-by-one.
 */
export function pickRowClosestToViewportCenter(
  entries: readonly CenterDistanceEntry[],
): string | null {
  if (entries.length === 0) return null;
  return entries.reduce((best, cur) =>
    cur.distanceFromCenterPx < best.distanceFromCenterPx ? cur : best,
  ).rowId;
}

const DEFAULT_HEADER_OFFSET_PX = 52; // 3.25rem app shell header

/** Shrink the observer root so "visible" ignores chrome and docked preview panes. */
export function followMeObserverRootMargin(options: {
  previewOpen: boolean;
  placement: PreviewPlacement;
  dockHeightPx: number;
  headerOffsetPx?: number;
}): string {
  const header = options.headerOffsetPx ?? DEFAULT_HEADER_OFFSET_PX;
  let top = header;
  let bottom = 0;
  if (options.previewOpen && options.placement === "top") {
    top = header + options.dockHeightPx;
  }
  if (options.previewOpen && options.placement === "bottom") {
    bottom = options.dockHeightPx;
  }
  const bottomMargin = bottom > 0 ? `-${bottom}px` : "0px";
  return `-${top}px 0px ${bottomMargin} 0px`;
}

/** Effective vertical center of the observer root (matches rootMargin insets). */
export function followMeViewportCenterY(options: {
  viewportHeight: number;
  previewOpen: boolean;
  placement: PreviewPlacement;
  dockHeightPx: number;
  headerOffsetPx?: number;
}): number {
  const header = options.headerOffsetPx ?? DEFAULT_HEADER_OFFSET_PX;
  let top = header;
  let bottom = 0;
  if (options.previewOpen && options.placement === "top") {
    top = header + options.dockHeightPx;
  }
  if (options.previewOpen && options.placement === "bottom") {
    bottom = options.dockHeightPx;
  }
  const visibleHeight = options.viewportHeight - top - bottom;
  return top + visibleHeight / 2;
}
