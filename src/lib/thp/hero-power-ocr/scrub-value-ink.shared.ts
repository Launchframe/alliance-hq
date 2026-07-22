/**
 * Remove comma-sized ink blobs from a greyscale Power Details value crop.
 *
 * ## Why
 *
 * Digits-only Tesseract whitelists still map thousand-commas onto nearby
 * digits (`85,868,520` → `858681520`). Commas must be erased in image space
 * before OCR — character-set tricks are not enough.
 *
 * ## Assumptions
 *
 * - Input is greyscale (1 channel), dark ink on light background (invert first
 *   when the UI uses white outlined text on grey).
 * - Thousand separators are **small** connected components relative to digit
 *   glyphs (commas sit below the baseline and cover few pixels).
 * - Dropdown-arrow chrome and noise blobs are similarly small and safe to drop.
 * - We never remove the largest ~median ink components (actual digits).
 */

export type ScrubInkOptions = {
  /** Pixels darker than this count as ink (0–255). */
  inkThreshold?: number;
  /**
   * Drop components whose pixel area is below this fraction of the median
   * area among "large" components (area ≥ `minDigitArea`).
   */
  maxAreaFractionOfMedian?: number;
  /** Absolute floor — never treat fewer pixels than this as a digit. */
  minDigitArea?: number;
  /** Absolute ceiling for "comma-sized" removals. */
  maxScrubArea?: number;
};

type Component = {
  id: number;
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/**
 * Threshold greyscale → binary ink mask, flood-fill components, paint small
 * ones white. Returns a new greyscale Buffer (same dimensions).
 */
export function scrubSmallInkComponents(
  greyscale: Buffer,
  width: number,
  height: number,
  opts: ScrubInkOptions = {},
): Buffer {
  const inkThreshold = opts.inkThreshold ?? 140;
  const maxAreaFractionOfMedian = opts.maxAreaFractionOfMedian ?? 0.22;
  const minDigitArea = opts.minDigitArea ?? 40;
  const maxScrubArea = opts.maxScrubArea ?? 400;

  const ink = new Uint8Array(width * height);
  for (let i = 0; i < greyscale.length; i += 1) {
    ink[i] = greyscale[i]! < inkThreshold ? 1 : 0;
  }

  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  let nextId = 1;

  const stack: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!ink[start] || labels[start]) continue;

      const id = nextId;
      nextId += 1;
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      stack.length = 0;
      stack.push(start);
      labels[start] = id;

      while (stack.length > 0) {
        const idx = stack.pop()!;
        area += 1;
        const cx = idx % width;
        const cy = (idx / width) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        if (cx > 0) {
          const left = idx - 1;
          if (ink[left] && !labels[left]) {
            labels[left] = id;
            stack.push(left);
          }
        }
        if (cx + 1 < width) {
          const right = idx + 1;
          if (ink[right] && !labels[right]) {
            labels[right] = id;
            stack.push(right);
          }
        }
        if (cy > 0) {
          const up = idx - width;
          if (ink[up] && !labels[up]) {
            labels[up] = id;
            stack.push(up);
          }
        }
        if (cy + 1 < height) {
          const down = idx + width;
          if (ink[down] && !labels[down]) {
            labels[down] = id;
            stack.push(down);
          }
        }
      }

      components.push({ id, area, minX, maxX, minY, maxY });
    }
  }

  const digitLike = components.filter((c) => c.area >= minDigitArea);
  const areas = digitLike.map((c) => c.area).sort((a, b) => a - b);
  const heights = digitLike
    .map((c) => c.maxY - c.minY + 1)
    .sort((a, b) => a - b);
  const medianArea =
    areas.length === 0
      ? minDigitArea * 4
      : areas[Math.floor(areas.length / 2)]!;
  const medianHeight =
    heights.length === 0
      ? 20
      : heights[Math.floor(heights.length / 2)]!;
  const scrubAreaLimit = Math.min(
    maxScrubArea,
    Math.max(12, Math.floor(medianArea * maxAreaFractionOfMedian)),
  );
  // Commas sit below the baseline and are much shorter than digit glyphs.
  const scrubHeightLimit = Math.max(4, Math.floor(medianHeight * 0.45));

  const scrubIds = new Set(
    components
      .filter((c) => {
        if (c.area <= 0) return false;
        const h = c.maxY - c.minY + 1;
        const w = c.maxX - c.minX + 1;
        if (c.area <= scrubAreaLimit && h <= scrubHeightLimit) return true;
        // Tall thin noise (dropdown chevron fragments, etc.)
        if (c.area <= scrubAreaLimit && w <= 4 && h <= medianHeight) return true;
        return false;
      })
      .map((c) => c.id),
  );

  const out = Buffer.from(greyscale);
  for (let i = 0; i < labels.length; i += 1) {
    if (scrubIds.has(labels[i]!)) {
      out[i] = 255;
    }
  }
  return out;
}
