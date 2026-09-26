import { describe, expect, it } from "vitest";

import type { OcrLineResult } from "@/lib/members/roster-ocr/tesseract";
import { pickHeaderTotal } from "@/lib/thp/hero-power-ocr/parse-power-details-image";
import type { NormalizedGeometryLine } from "@/lib/thp/hero-power-ocr/parse-power-details-geometry.shared";

function ocrLine(text: string, y: number): OcrLineResult {
  return {
    text,
    confidence: 0,
    bbox: { x0: 0, y0: y - 1, x1: 10, y1: y + 1 },
  };
}

describe("pickHeaderTotal", () => {
  it("selects the value aligned with the Hero Power label", () => {
    const labels: NormalizedGeometryLine[] = [
      { text: "(BD) HerolPowers", yNorm: 0.293, yCenterPx: 293 },
    ];

    const result = pickHeaderTotal(
      labels,
      [],
      0,
      [ocrLine("17979827025", 293), ocrLine("146443134", 459)],
      1000,
      [],
      0,
    );

    expect(result).toBe(179_982_025);
  });

  it("does not promote a lower component row when the aligned header is unreadable", () => {
    const labels: NormalizedGeometryLine[] = [
      { text: "(BD) HerolPowers", yNorm: 0.293, yCenterPx: 293 },
    ];

    const result = pickHeaderTotal(
      labels,
      [],
      0,
      [ocrLine("garbage", 293), ocrLine("146443134", 459)],
      1000,
      [],
      0,
    );

    expect(result).toBeNull();
  });

  it("uses the dedicated header crop only when the Hero Power label is missing", () => {
    const labels: NormalizedGeometryLine[] = [
      { text: "Hero Level", yNorm: 0.35, yCenterPx: 350 },
    ];

    const result = pickHeaderTotal(
      labels,
      [ocrLine("17979827025", 10)],
      100,
      [ocrLine("146443134", 459)],
      1000,
      [],
      0,
    );

    expect(result).toBe(179_982_025);
  });
});
