import type { PreviewPlacement } from "@/lib/video/preview-layout";

export type FollowMeScrollDirection = "up" | "down" | "unknown";

/** Map row id → index in the current filtered table order. */
export function buildRowOrderIndex(
  rows: ReadonlyArray<{ id: string }>,
): Map<string, number> {
  const map = new Map<string, number>();
  rows.forEach((row, index) => map.set(row.id, index));
  return map;
}

export type CenterDistanceEntry = {
  rowId: string;
  distanceFromCenterPx: number;
};

/**
 * Pick one row id from anchors that just entered the observer root.
 * Scrolling down → highest table index (entered from bottom); up → lowest.
 */
export function pickNewlyEnteredRow(
  rowIds: readonly string[],
  rowOrderById: ReadonlyMap<string, number>,
  scrollDirection: FollowMeScrollDirection,
): string | null {
  if (rowIds.length === 0) return null;
  if (rowIds.length === 1) return rowIds[0] ?? null;

  const indexed = rowIds
    .map((id) => ({ id, index: rowOrderById.get(id) ?? -1 }))
    .filter((entry) => entry.index >= 0);

  if (indexed.length === 0) return rowIds[0] ?? null;

  if (scrollDirection === "down") {
    return indexed.reduce((best, cur) =>
      cur.index > best.index ? cur : best,
    ).id;
  }

  return indexed.reduce((best, cur) => (cur.index < best.index ? cur : best)).id;
}

/** Initial sync when Follow me is enabled — row closest to viewport center. */
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
