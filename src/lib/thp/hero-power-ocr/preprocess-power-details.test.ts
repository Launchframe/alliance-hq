import { describe, expect, it } from "vitest";

import {
  powerDetailsHeaderValueBand,
  powerDetailsModalCrop,
} from "@/lib/thp/hero-power-ocr/preprocess-power-details";

describe("power details frame", () => {
  it("keeps the phone window under the resource HUD", () => {
    expect(powerDetailsModalCrop("phone")).toEqual({
      left: 0.06,
      top: 0.11,
      width: 0.88,
      height: 0.55,
    });
    expect(powerDetailsHeaderValueBand("phone").top).toBe(0.02);
  });

  it("uses the whole file when the upload is the menu", () => {
    expect(powerDetailsModalCrop("menu")).toEqual({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });
    expect(powerDetailsHeaderValueBand("menu").top).toBeGreaterThan(0.1);
  });
});
