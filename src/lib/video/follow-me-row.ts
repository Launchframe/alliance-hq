import type { PreviewPlacement } from "@/lib/video/preview-layout";

export type FollowAnchorSample = {
  /** Interpolation knot: video time (seconds) for this row's frame. */
  seconds: number;
  /** Vertical center of the row's anchor, in viewport pixels. */
  centerPx: number;
};

/**
 * Map the viewport-center position to a video time by linearly interpolating
 * between the two row anchors that bracket the center.
 *
 * Each visible row anchor is a knot: (anchor vertical center px → that row's
 * frame time). As the reviewer scrolls, the center glides between adjacent
 * knots, so the preview scrubs smoothly through the source video instead of
 * snapping to the nearest row's discrete frame timestamp. The result is clamped
 * to the first/last anchor's time when the center is outside the anchor span,
 * and floored at 0. Returns null when there are no usable samples.
 *
 * Tracking the center (rather than a scroll-direction leading edge) keeps the
 * previewed frame aligned with the on-screen roster symmetrically in both
 * directions.
 */
export function interpolateSecondsAtCenter(
  samples: readonly FollowAnchorSample[],
  centerY: number,
): number | null {
  const usable = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.seconds) && Number.isFinite(sample.centerPx),
    )
    .sort((a, b) => a.centerPx - b.centerPx);

  if (usable.length === 0) return null;

  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  if (centerY <= first.centerPx) return Math.max(0, first.seconds);
  if (centerY >= last.centerPx) return Math.max(0, last.seconds);

  for (let i = 0; i < usable.length - 1; i += 1) {
    const a = usable[i]!;
    const b = usable[i + 1]!;
    if (centerY >= a.centerPx && centerY <= b.centerPx) {
      const span = b.centerPx - a.centerPx;
      if (span <= 0) return Math.max(0, a.seconds);
      const t = (centerY - a.centerPx) / span;
      return Math.max(0, a.seconds + t * (b.seconds - a.seconds));
    }
  }

  return Math.max(0, last.seconds);
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
