/**
 * Row detection for the in-game VS Daily/Weekly Rank screen.
 *
 * Each commander is a colored card (gold, blue, bronze, green) on a near-white
 * panel, with cream gaps between cards. Warzone card detection looks for the
 * opposite — bright cards on a dark list — and merges this whole panel into
 * one band. Here a scanline is a card when its median luminance sits in the
 * card-fill range, and a gap when it is the brighter panel.
 */

export type VsRankingCard = { y0: number; y1: number };

const CARD_LUMINANCE_MIN = 145;
const CARD_LUMINANCE_MAX = 236;

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

export function detectVsRankingCards(
  data: Uint8Array | Buffer,
  channels: number,
  width: number,
  height: number,
): VsRankingCard[] {
  if (width < 40 || height < 40 || channels < 3) return [];
  const y0 = Math.round(height * 0.18);
  const y1 = height - 4;
  const x0 = Math.round(width * 0.08);
  const x1 = Math.round(width * 0.92);
  const stride = Math.max(1, Math.floor((x1 - x0) / 180));
  const isCard: boolean[] = [];
  for (let y = y0; y < y1; y++) {
    const samples: number[] = [];
    for (let x = x0; x < x1; x += stride) {
      samples.push(luminanceAt(data, channels, width, x, y));
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    isCard.push(median >= CARD_LUMINANCE_MIN && median <= CARD_LUMINANCE_MAX);
  }

  const bands: VsRankingCard[] = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i <= isCard.length; i++) {
    if (i < isCard.length && isCard[i]) {
      if (start < 0) start = i;
      gap = 0;
      continue;
    }
    if (start < 0) continue;
    gap++;
    if (gap > 4 || i === isCard.length) {
      bands.push({ y0: y0 + start, y1: y0 + i - gap });
      start = -1;
      gap = 0;
    }
  }

  const minHeight = Math.round(height * 0.055);
  const maxHeight = Math.round(height * 0.14);
  return bands.filter((band) => {
    const bandHeight = band.y1 - band.y0;
    return (
      bandHeight >= minHeight &&
      bandHeight <= maxHeight &&
      band.y0 > y0 + 2 &&
      band.y1 < y1 - 2
    );
  });
}

const CHROME_NAME =
  /^(?:ranking|commander|points|daily|weekly|alliance|your alliance|big delinquents|mon|tues|wed|thur|fri|sat|pontua[çc][aã]o|pontos|total)\b/iu;

/**
 * Keep the commander name and drop avatar/icon fragments that share the crop.
 * A single uppercase initial ("C Price") and a two-letter word ("La Bdo") stay.
 */
export function cleanVsRankingName(raw: string): string {
  const tokens = raw
    .replace(/[|[\]{}]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (tokens.length > 1) {
    const head = tokens[0]!;
    const keep =
      /^[\p{Lu}]$/u.test(head) ||
      /^[\p{L}][\p{L}\p{N}]{1,}$/u.test(head);
    if (keep) break;
    tokens.shift();
  }
  return tokens.join(" ").trim();
}

export function isVsRankingName(name: string): boolean {
  const cleaned = name.trim();
  if (CHROME_NAME.test(cleaned)) return false;
  if (!/[\p{L}]/u.test(cleaned)) return false;
  if (!/[\p{L}\p{N}]{3,}/u.test(cleaned)) return false;
  const chars = cleaned.replace(/\s+/g, "");
  const letters = (chars.match(/[\p{L}]/gu) ?? []).length;
  return letters >= 2 && letters / chars.length >= 0.25;
}

/**
 * Points text from one card. Thousands separators must be complete — a
 * trailing pair like "24,404.61" is a clipped read, not a score.
 */
function parseScoreBody(body: string): string | null {
  if (!body || /\s/.test(body)) return null;
  const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(body);
  const plain = /^\d{1,10}$/.test(body);
  if (!grouped && !plain) return null;
  const digits = body.replace(/\D/g, "");
  if (!digits || digits.length > 10) return null;
  if (!grouped && digits.length < 4 && digits !== "0") return null;
  return digits;
}

export function parseVsRankingScore(raw: string): string | null {
  const trimmed = raw.trim();
  const body = trimmed.replace(/^[^\d]+|[^\d]+$/g, "");
  if (!/\s/.test(trimmed)) return parseScoreBody(body);
  // The alliance-name tail shares the score crop and can become a stray
  // digit ("1 19,979,478"). Keep the one complete grouped number. A short
  // tail ("24,404.61") stays unresolved so the trailing-1 repair can run.
  const match = /\d{1,3}(?:[.,]\d{3})+/.exec(trimmed);
  if (!match) return null;
  const before = trimmed.slice(0, match.index);
  const after = trimmed.slice(match.index + match[0].length);
  if (/\d/.test(after)) return null;
  if ((before.match(/\d/g) ?? []).length > 1) return null;
  return parseScoreBody(match[0]);
}

const SHORT_LAST_GROUP = /^\d{1,3}(?:[.,]\d{3})+[.,]\d{2}$/;

/**
 * Eng Tesseract drops a trailing "1" and turns the comma in front of it into
 * a dot ("24,404,611" → "24,404.61"). Put the 1 back only when the score
 * ink still has one extra narrow digit on the right.
 */
export function repairVsRankingScore(
  raw: string,
  evidence: { extraNarrowDigit: boolean },
): string | null {
  const direct = parseVsRankingScore(raw);
  if (direct) return direct;
  if (!evidence.extraNarrowDigit) return null;
  const body = raw.trim().replace(/^[^\d]+|[^\d]+$/g, "");
  if (!SHORT_LAST_GROUP.test(body)) return null;
  return parseVsRankingScore(`${body}1`);
}

type GlyphBox = { x0: number; y0: number; x1: number; y1: number };

/** Digit-like ink on the right of one ranking card. */
export function scoreHasExtraNarrowDigit(
  data: Uint8Array | Buffer,
  channels: number,
  width: number,
  card: VsRankingCard,
  recognizedDigits: number,
): boolean {
  if (recognizedDigits < 4 || channels < 3 || width < 40) return false;
  const bandHeight = card.y1 - card.y0;
  const top = card.y0 + Math.round(bandHeight * 0.18);
  const bottom = Math.min(card.y1 - 1, card.y0 + Math.round(bandHeight * 0.72));
  const xStart = Math.round(width * 0.67);
  const xEnd = Math.min(width - 1, Math.round(width * 0.9));
  if (bottom - top < 8 || xEnd - xStart < 8) return false;

  const lum = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    return 0.3 * data[i]! + 0.5 * data[i + 1]! + 0.2 * data[i + 2]!;
  };
  const seen = new Uint8Array((bottom - top + 1) * (xEnd - xStart + 1));
  const at = (x: number, y: number) => (y - top) * (xEnd - xStart + 1) + (x - xStart);
  const boxes: GlyphBox[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      if (seen[at(x, y)] || lum(x, y) >= 110) continue;
      let bx0 = x;
      let by0 = y;
      let bx1 = x;
      let by1 = y;
      let count = 0;
      const stack: Array<[number, number]> = [[x, y]];
      seen[at(x, y)] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        count++;
        if (cx < bx0) bx0 = cx;
        if (cy < by0) by0 = cy;
        if (cx > bx1) bx1 = cx;
        if (cy > by1) by1 = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < xStart || nx > xEnd || ny < top || ny > bottom) continue;
          if (seen[at(nx, ny)] || lum(nx, ny) >= 110) continue;
          seen[at(nx, ny)] = 1;
          stack.push([nx, ny]);
        }
      }
      if (count >= 8) boxes.push({ x0: bx0, y0: by0, x1: bx1, y1: by1 });
    }
  }
  if (!boxes.length) return false;
  const tallest = Math.max(...boxes.map((box) => box.y1 - box.y0));
  const digits = boxes
    .filter((box) => box.y1 - box.y0 >= tallest * 0.65)
    .sort((a, b) => a.x0 - b.x0);
  if (digits.length !== recognizedDigits + 1) return false;
  const widths = digits.map((box) => box.x1 - box.x0).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  const rightmost = digits[digits.length - 1]!;
  return median > 0 && rightmost.x1 - rightmost.x0 <= median * 0.75;
}
