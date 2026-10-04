/**
 * Structural row-card detection for Warzone evidence frames.
 *
 * Both Warzone layouts render each member row as a solid-fill rounded card:
 * light-blue/green cards inside the RANKING table, white cards inside the
 * VOTING MEMBERS dialog. Card fill is the dominant high-luminance color
 * below the header, so a per-scanline luminance profile separates card
 * bands from the dark list background without hardcoding game colors.
 *
 * Input is a raw RGB(A) pixel buffer (e.g. sharp `.raw()` output) of a
 * frame already normalized to the canonical pipeline width, so all
 * thresholds here are resolution-independent.
 */

export type PixelCard = { x0: number; y0: number; x1: number; y1: number };

export type CardDetectOptions = {
  /** Scan range, pixels. Cards are detected inside [x0,x1] × [y0,y1). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Card band height bounds in pixels (canonical-width space). */
  minHeight?: number;
  maxHeight?: number;
};

function luminanceAt(
  data: Uint8Array | Buffer,
  channels: number,
  width: number,
  x: number,
  y: number,
): number {
  const i = (y * width + x) * channels;
  return 0.3 * data[i]! + 0.5 * data[i + 1]! + 0.2 * data[i + 2]!;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx]!;
}

/**
 * Detect card bands in [y0,y1). Returns card rects in pixel space.
 * Bands touching the scan bounds are excluded — a card clipped by the
 * frame edge or the header is only partially visible.
 */
export function detectCardBands(
  data: Uint8Array | Buffer,
  channels: number,
  width: number,
  height: number,
  options: CardDetectOptions,
): PixelCard[] {
  const x0 = Math.max(0, Math.floor(options.x0));
  const x1 = Math.min(width, Math.ceil(options.x1));
  const y0 = Math.max(0, Math.floor(options.y0));
  const y1 = Math.min(height, Math.ceil(options.y1));
  if (x1 - x0 < 8 || y1 - y0 < 8) return [];

  const minHeight = options.minHeight ?? Math.round(height * 0.012);
  const maxHeight = options.maxHeight ?? Math.round(height * 0.09);

  // Per-scanline luminance stats over the scan range. Median catches the
  // fill; stddev catches text lines (dark glyphs on a light card have high
  // contrast, while the dark gap BETWEEN cards is uniform).
  const medians = new Array<number>(y1 - y0).fill(0);
  const stds = new Array<number>(y1 - y0).fill(0);
  const stride = Math.max(1, Math.floor((x1 - x0) / 160));
  for (let y = y0; y < y1; y++) {
    const samples: number[] = [];
    for (let x = x0; x < x1; x += stride) {
      samples.push(luminanceAt(data, channels, width, x, y));
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance =
      samples.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
      samples.length;
    medians[y - y0] = percentile(samples, 0.5);
    stds[y - y0] = Math.sqrt(variance);
  }

  // Card interior scanlines share one dominant fill luminance (median of
  // the uniform rows). Band separators are uniform scanlines that are
  // clearly brighter (the light panel gap) or uniformly dark, while text
  // lines inside a card keep the fill median with high stddev.
  const uniformMedians = medians.filter((_, i) => stds[i]! < 10);
  const sortedUniform = [...uniformMedians].sort((a, b) => a - b);
  const cardLum = percentile(
    sortedUniform.filter((m) => m > 150),
    0.5,
  );
  if (cardLum < 150) return [];

  const isCardRow = medians.map((m, i) => {
    const std = stds[i]!;
    // Uniform row clearly brighter or darker than the card fill is a
    // separator or background scanline, not card interior.
    if (std < 12 && (m > cardLum + 18 || m < cardLum * 0.55)) return false;
    // Text/contrast on the card fill still counts as interior.
    return m > cardLum * 0.55;
  });

  // Merge card rows into bands, tolerating 2px dips (text edge artifacts).
  const bands: Array<{ y0: number; y1: number }> = [];
  let bandStart = -1;
  let gap = 0;
  for (let i = 0; i <= isCardRow.length; i++) {
    const row = i < isCardRow.length ? isCardRow[i]! : false;
    if (row) {
      if (bandStart < 0) bandStart = i;
      gap = 0;
    } else if (bandStart >= 0) {
      gap++;
      if (gap > 2 || i === isCardRow.length) {
        const end = i - gap;
        bands.push({ y0: y0 + bandStart, y1: y0 + end });
        bandStart = -1;
        gap = 0;
      }
    }
  }

  const cards: PixelCard[] = [];
  for (const band of bands) {
    const bandHeight = band.y1 - band.y0;
    if (bandHeight < minHeight || bandHeight > maxHeight) continue;
    // Cards clipped by the scan bounds are partially visible — skip them
    // rather than OCR a cut-off row into a wrong/garbled value.
    if (band.y0 <= y0 + 1 || band.y1 >= y1 - 1) continue;

    // Card horizontal extent: on the band's middle row, the contiguous
    // span of pixels brighter than the split threshold.
    const midY = Math.min(y1 - 1, band.y0 + Math.floor(bandHeight / 2));
    let cx0 = -1;
    let cx1 = -1;
    for (let x = x0; x < x1; x++) {
      const bright =
        luminanceAt(data, channels, width, x, midY) > cardLum * 0.55;
      if (bright) {
        if (cx0 < 0) cx0 = x;
        cx1 = x;
      }
    }
    if (cx0 < 0 || cx1 - cx0 < (x1 - x0) * 0.4) continue;
    cards.push({ x0: cx0, y0: band.y0, x1: cx1, y1: band.y1 });
  }
  return cards;
}
