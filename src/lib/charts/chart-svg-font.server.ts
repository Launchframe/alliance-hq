import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHART_SVG_FONT_FAMILY_EMBEDDED,
  CHART_SVG_FONT_FAMILY_WEB,
} from "@/lib/charts/chart-svg-font.shared";

let cachedFontDefs: string | null = null;

function chartSvgFontDefs(): string {
  if (cachedFontDefs) return cachedFontDefs;

  const fontPath = join(
    process.cwd(),
    "src/lib/charts/assets/Inter-Regular.woff2",
  );
  const base64 = readFileSync(fontPath).toString("base64");
  cachedFontDefs = `<defs><style>@font-face{font-family:'HQChartFont';src:url(data:font/woff2;base64,${base64}) format('woff2');font-weight:400;font-style:normal;}</style></defs>`;
  return cachedFontDefs;
}

/** Embed a portable font and swap the web font stack for PNG/librsvg rendering. */
export function embedChartSvgFont(svg: string): string {
  return svg
    .replace(/(<svg[^>]*>)/, `$1${chartSvgFontDefs()}`)
    .replaceAll(
      `font-family="${CHART_SVG_FONT_FAMILY_WEB}"`,
      `font-family="${CHART_SVG_FONT_FAMILY_EMBEDDED}"`,
    );
}
