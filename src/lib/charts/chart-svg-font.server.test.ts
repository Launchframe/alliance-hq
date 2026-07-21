import { describe, expect, it } from "vitest";

import { CHART_SVG_FONT_FAMILY_EMBEDDED } from "@/lib/charts/chart-svg-font.shared";
import { embedChartSvgFont } from "@/lib/charts/chart-svg-font.server";

describe("embedChartSvgFont", () => {
  it("injects @font-face defs and swaps the font family", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="system-ui, sans-serif">1,234</text></svg>';
    const embedded = embedChartSvgFont(svg);
    expect(embedded).toContain("@font-face");
    expect(embedded).toContain("data:font/woff2;base64,");
    expect(embedded).toContain(`font-family="${CHART_SVG_FONT_FAMILY_EMBEDDED}"`);
    expect(embedded).not.toContain('font-family="system-ui, sans-serif"');
  });
});
