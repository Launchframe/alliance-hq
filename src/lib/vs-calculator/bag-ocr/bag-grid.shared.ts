import type { BagCellBounds, BagGridLayout } from "@/lib/vs-calculator/bag-ocr/bag-ocr.shared";

const DEFAULT_COLS = 4;

export function inferBagGridLayout(
  imgW: number,
  imgH: number,
  cols = DEFAULT_COLS,
): BagGridLayout {
  const padX = Math.round(imgW * 0.04);
  const padY = Math.round(imgH * 0.08);
  const innerW = Math.max(1, imgW - padX * 2);
  const innerH = Math.max(1, imgH - padY * 2);
  const cellW = Math.floor(innerW / cols);
  const cellH = cellW;
  const rows = Math.max(1, Math.floor(innerH / cellH));
  return {
    cols,
    rows,
    padLeft: padX,
    padTop: padY,
    cellW,
    cellH,
  };
}

export function bagCellBounds(
  layout: BagGridLayout,
  index: number,
): BagCellBounds {
  const col = index % layout.cols;
  const row = Math.floor(index / layout.cols);
  return {
    left: layout.padLeft + col * layout.cellW,
    top: layout.padTop + row * layout.cellH,
    width: layout.cellW,
    height: layout.cellH,
  };
}

/** Icon crop: upper portion of the cell (stack count sits bottom-right). */
export function bagIconRegion(bounds: BagCellBounds): BagCellBounds {
  const margin = Math.round(bounds.width * 0.06);
  const iconH = Math.round(bounds.height * 0.72);
  return {
    left: bounds.left + margin,
    top: bounds.top + margin,
    width: Math.max(1, bounds.width - margin * 2),
    height: Math.max(1, iconH - margin),
  };
}

/** Quantity badge: lower-right corner of the cell. */
export function bagQuantityRegion(bounds: BagCellBounds): BagCellBounds {
  const w = Math.round(bounds.width * 0.55);
  const h = Math.round(bounds.height * 0.38);
  return {
    left: bounds.left + bounds.width - w,
    top: bounds.top + bounds.height - h,
    width: w,
    height: h,
  };
}

export function bagCellCount(layout: BagGridLayout): number {
  return layout.cols * layout.rows;
}
