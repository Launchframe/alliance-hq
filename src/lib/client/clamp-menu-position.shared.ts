export type ViewportSize = {
  width: number;
  height: number;
};

export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: ViewportSize,
  padding = 8,
): { left: number; top: number } {
  let left = x;
  let top = y;
  if (left + width > viewport.width - padding) {
    left = Math.max(padding, viewport.width - width - padding);
  }
  if (left < padding) left = padding;
  if (top + height > viewport.height - padding) {
    top = Math.max(padding, viewport.height - height - padding);
  }
  if (top < padding) top = padding;
  return { left, top };
}
