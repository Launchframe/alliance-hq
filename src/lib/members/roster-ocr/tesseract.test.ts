import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTesseractWorkerOptions } from "@/lib/members/roster-ocr/tesseract";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildTesseractWorkerOptions", () => {
  it("omits langPath by default so tesseract.js uses CDN traineddata", () => {
    vi.stubEnv("TESSERACT_LANG_PATH", "");
    expect(buildTesseractWorkerOptions().langPath).toBeUndefined();
  });

  it("passes trimmed TESSERACT_LANG_PATH when set", () => {
    vi.stubEnv(
      "TESSERACT_LANG_PATH",
      "  https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int  ",
    );
    expect(buildTesseractWorkerOptions().langPath).toBe(
      "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int",
    );
  });
});
