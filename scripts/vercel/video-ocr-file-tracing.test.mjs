import { describe, expect, it } from "vitest";

import {
  functionTraceBudgets,
  sharpFileTracing,
  videoOcrTracedRoutes,
} from "./video-ocr-file-tracing.mjs";

describe("videoOcrTracedRoutes", () => {
  it("includes inline reprocess OCR route", () => {
    expect(videoOcrTracedRoutes).toHaveProperty(
      "/api/tools/video-upload/[jobId]/reprocess",
    );
  });

  it("traces libvips shared libraries for sharp 0.35", () => {
    expect(sharpFileTracing).toContain(
      "./node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so*",
    );
  });

  it("budgets every traced OCR route", () => {
    for (const route of Object.keys(videoOcrTracedRoutes)) {
      expect(functionTraceBudgets.some((budget) => budget.route === route)).toBe(
        true,
      );
    }
  });
});
