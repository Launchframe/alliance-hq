/**
 * Detect centered game UI modals (grey/beige panels) in screenshots.
 * Used by THP Power Details and future scoreboard crops.
 */

export type CropRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type GameModalDetectMethod = "grey_cc" | "fallback_preset";

export type GameModalDetectResult = {
  rect: CropRect;
  confidence: number;
  method: GameModalDetectMethod;
};

export type GameModalDetectHints = {
  greyLumaMin?: number;
  greyLumaMax?: number;
  maxSaturation?: number;
  minAreaFraction?: number;
  maxAreaFraction?: number;
  downscaleMaxEdge?: number;
};

const DEFAULT_HINTS: Required<GameModalDetectHints> = {
  greyLumaMin: 155,
  greyLumaMax: 235,
  maxSaturation: 0.22,
  minAreaFraction: 0.12,
  maxAreaFraction: 0.82,
  downscaleMaxEdge: 800,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isGreyPixel(
  r: number,
  g: number,
  b: number,
  hints: Required<GameModalDetectHints>,
): boolean {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luma < hints.greyLumaMin || luma > hints.greyLumaMax) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation <= hints.maxSaturation;
}

type Component = {
  id: number;
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function floodComponent(
  mask: Uint8Array,
  labels: Int32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  id: number,
): Component {
  const stack: number[] = [startY * width + startX];
  let area = 0;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (labels[idx] || !mask[idx]) continue;
    labels[idx] = id;
    area += 1;
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  return { id, area, minX, maxX, minY, maxY };
}

function scaleRect(rect: CropRect, scaleX: number, scaleY: number): CropRect {
  return {
    left: Math.round(rect.left * scaleX),
    top: Math.round(rect.top * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY),
  };
}

function validateModalRect(
  rect: CropRect,
  srcWidth: number,
  srcHeight: number,
  hints: Required<GameModalDetectHints>,
): { ok: boolean; confidence: number } {
  const area = rect.width * rect.height;
  const srcArea = srcWidth * srcHeight;
  const fraction = area / Math.max(1, srcArea);
  if (fraction < hints.minAreaFraction || fraction > hints.maxAreaFraction) {
    return { ok: false, confidence: 0 };
  }
  const touchesLeft = rect.left <= 2;
  const touchesTop = rect.top <= 2;
  const touchesRight = rect.left + rect.width >= srcWidth - 2;
  const touchesBottom = rect.top + rect.height >= srcHeight - 2;
  if (touchesLeft && touchesTop && touchesRight && touchesBottom) {
    return { ok: false, confidence: 0 };
  }
  const aspect = rect.width / Math.max(1, rect.height);
  if (aspect < 0.35 || aspect > 2.2) {
    return { ok: false, confidence: 0 };
  }
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = Math.abs(centerX - srcWidth / 2) / srcWidth;
  const dy = Math.abs(centerY - srcHeight / 2) / srcHeight;
  const centerScore = 1 - clamp((dx + dy) / 2, 0, 1);
  const areaScore = 1 - Math.abs(fraction - 0.45) / 0.45;
  return { ok: true, confidence: clamp(0.35 + centerScore * 0.4 + areaScore * 0.25, 0, 1) };
}

/**
 * Find the largest low-saturation grey connected component near image center.
 */
export async function detectGameModalRect(
  imageBuffer: Buffer,
  hints: GameModalDetectHints = {},
): Promise<GameModalDetectResult | null> {
  const h = { ...DEFAULT_HINTS, ...hints };
  const sharp = (await import("sharp")).default;
  const meta = await sharp(imageBuffer).metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;
  const scale =
    Math.max(srcWidth, srcHeight) > h.downscaleMaxEdge
      ? h.downscaleMaxEdge / Math.max(srcWidth, srcHeight)
      : 1;
  const dsWidth = Math.max(1, Math.round(srcWidth * scale));
  const dsHeight = Math.max(1, Math.round(srcHeight * scale));

  const { data, info } = await sharp(imageBuffer)
    .resize(dsWidth, dsHeight, { kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const mask = new Uint8Array(dsWidth * dsHeight);
  for (let i = 0, p = 0; i < data.length; i += channels, p += 1) {
    mask[p] = isGreyPixel(data[i]!, data[i + 1]!, data[i + 2]!, h) ? 1 : 0;
  }

  const labels = new Int32Array(dsWidth * dsHeight);
  const components: Component[] = [];
  let nextId = 1;
  const cx = Math.floor(dsWidth / 2);
  const cy = Math.floor(dsHeight / 2);
  const centerIdx = cy * dsWidth + cx;

  if (mask[centerIdx]) {
    components.push(
      floodComponent(mask, labels, dsWidth, dsHeight, cx, cy, nextId++),
    );
  }

  for (let y = 0; y < dsHeight; y += 1) {
    for (let x = 0; x < dsWidth; x += 1) {
      const idx = y * dsWidth + x;
      if (!mask[idx] || labels[idx]) continue;
      components.push(
        floodComponent(mask, labels, dsWidth, dsHeight, x, y, nextId++),
      );
    }
  }

  if (components.length === 0) return null;

  const centerComponent = components[0]!;
  const best =
    components
      .filter((c) => {
        const mx = (c.minX + c.maxX) / 2;
        const my = (c.minY + c.maxY) / 2;
        return (
          mx >= dsWidth * 0.2 &&
          mx <= dsWidth * 0.8 &&
          my >= dsHeight * 0.08 &&
          my <= dsHeight * 0.92
        );
      })
      .sort((a, b) => b.area - a.area)[0] ?? centerComponent;

  const padX = Math.round((best.maxX - best.minX + 1) * 0.015);
  const padY = Math.round((best.maxY - best.minY + 1) * 0.015);
  const dsRect: CropRect = {
    left: Math.max(0, best.minX - padX),
    top: Math.max(0, best.minY - padY),
    width: Math.min(dsWidth, best.maxX - best.minX + 1 + padX * 2),
    height: Math.min(dsHeight, best.maxY - best.minY + 1 + padY * 2),
  };

  const scaleX = srcWidth / dsWidth;
  const scaleY = srcHeight / dsHeight;
  const rect = scaleRect(dsRect, scaleX, scaleY);
  rect.width = Math.min(rect.width, srcWidth - rect.left);
  rect.height = Math.min(rect.height, srcHeight - rect.top);

  const validation = validateModalRect(rect, srcWidth, srcHeight, h);
  if (!validation.ok) return null;

  return {
    rect,
    confidence: validation.confidence,
    method: "grey_cc",
  };
}

export function modalRectFromPreset(
  srcWidth: number,
  srcHeight: number,
  preset: { left: number; top: number; width: number; height: number },
  method: GameModalDetectMethod = "fallback_preset",
): GameModalDetectResult {
  const rect: CropRect = {
    left: Math.round(srcWidth * preset.left),
    top: Math.round(srcHeight * preset.top),
    width: Math.round(srcWidth * preset.width),
    height: Math.round(srcHeight * preset.height),
  };
  rect.width = Math.min(rect.width, srcWidth - rect.left);
  rect.height = Math.min(rect.height, srcHeight - rect.top);
  return { rect, confidence: 0.5, method };
}
