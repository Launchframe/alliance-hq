/**
 * Pure SVG tip-jar badge for Last War gold-brick gifts.
 * QR payload must be the public short URL only — never UID or loginToken.
 */

export const STORE_TIP_BADGE_WIDTH = 720;
export const STORE_TIP_BADGE_HEIGHT = 960;

export type StoreTipBadgeSvgInput = {
  headline: string;
  commanderName: string;
  allianceTag: string | null;
  shortUrlDisplay: string;
  /** Absolute URL encoded in the QR (e.g. https://host/b/code). */
  qrPayloadUrl: string;
  /** Pre-built QR module matrix from a QR encoder (true = dark). */
  qrModules: boolean[][];
  width?: number;
  height?: number;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Build QR module rects centered in a square region. */
function qrModuleRects(
  modules: boolean[][],
  originX: number,
  originY: number,
  size: number,
): string {
  if (modules.length === 0) return "";
  const n = modules.length;
  const cell = size / n;
  const parts: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules[y]?.[x]) continue;
      const px = originX + x * cell;
      const py = originY + y * cell;
      parts.push(
        `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#0b1220"/>`,
      );
    }
  }
  return parts.join("");
}

/** Small stack-of-bricks glyph, centered at (cx, topY), scaled by `s`. */
function brickGlyph(cx: number, topY: number, s: number): string {
  const brickW = 64 * s;
  const brickH = 26 * s;
  const gap = 6 * s;
  const rows = [0, 1, 2];
  const rects = rows
    .map((row) => {
      const y = topY + row * (brickH + gap);
      const inset = row === 1 ? brickW * 0.16 : 0;
      const w = brickW - inset * 2;
      return `<rect x="${(cx - w / 2).toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${brickH.toFixed(2)}" rx="${(6 * s).toFixed(2)}" fill="url(#tipBadgeBrick)" stroke="#78350f" stroke-opacity="0.35" stroke-width="1.5"/>`;
    })
    .join("");
  return `<g>${rects}</g>`;
}

export function buildStoreTipBadgeSvg(input: StoreTipBadgeSvgInput): string {
  const width = input.width ?? STORE_TIP_BADGE_WIDTH;
  const height = input.height ?? STORE_TIP_BADGE_HEIGHT;
  const name = escapeXml(truncate(input.commanderName, 28));
  const headline = escapeXml(truncate(input.headline, 32));
  const tag = input.allianceTag?.trim()
    ? escapeXml(truncate(input.allianceTag.trim(), 12))
    : null;
  const urlText = escapeXml(truncate(input.shortUrlDisplay, 48));

  const qrSize = Math.min(width * 0.52, 340);
  const qrX = (width - qrSize) / 2;
  const qrY = 330;
  const pad = 18;
  const qrInner = qrSize - pad * 2;

  const modules = input.qrModules;
  const qrRects = qrModuleRects(modules, qrX + pad, qrY + pad, qrInner);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${headline}">
  <defs>
    <linearGradient id="tipBadgeBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="45%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0c4a6e"/>
    </linearGradient>
    <linearGradient id="tipBadgeAccent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#fbbf24"/>
    </linearGradient>
    <linearGradient id="tipBadgeBrick" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fde68a"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
    <radialGradient id="tipBadgeGlow" cx="50%" cy="0%" r="65%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="36" fill="url(#tipBadgeBg)"/>
  <rect width="${width}" height="${height}" rx="36" fill="url(#tipBadgeGlow)"/>
  <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="28" fill="none" stroke="url(#tipBadgeAccent)" stroke-width="3" opacity="0.85"/>
  ${brickGlyph(width / 2, 74, 1)}
  <text x="${width / 2}" y="200" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="42" font-weight="700" fill="#f8fafc">${headline}</text>
  <text x="${width / 2}" y="252" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="34" font-weight="600" fill="#e2e8f0">${name}</text>
  ${
    tag
      ? `<text x="${width / 2}" y="290" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="500" fill="#7dd3fc">[${tag}]</text>`
      : ""
  }
  <rect x="${qrX - 4}" y="${qrY - 4}" width="${qrSize + 8}" height="${qrSize + 8}" rx="22" fill="none" stroke="#334155" stroke-width="2"/>
  <rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" rx="20" fill="#f8fafc"/>
  ${qrRects}
  <text x="${width / 2}" y="${qrY + qrSize + 56}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="22" fill="#cbd5e1">${urlText}</text>
</svg>`;
}
