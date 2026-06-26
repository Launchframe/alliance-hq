export const POINTER_SCROLL_DRAG_THRESHOLD_PX = 6;

/**
 * Returns the next scrollTop when pointer-drag panning, or null if movement is
 * below the drag threshold and dragging has not started yet.
 */
export function computePointerScrollTop(
  startScrollTop: number,
  startY: number,
  clientY: number,
  dragging: boolean,
): { scrollTop: number; dragging: true } | null {
  const dy = clientY - startY;
  if (!dragging && Math.abs(dy) < POINTER_SCROLL_DRAG_THRESHOLD_PX) {
    return null;
  }
  return { scrollTop: startScrollTop - dy, dragging: true };
}
