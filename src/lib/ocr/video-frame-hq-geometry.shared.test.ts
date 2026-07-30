import { describe, expect, it } from "vitest";

import {
  aggregateVideoJobHqGeometry,
  attachHqGeometryToOcrRawJson,
  buildDepositSlipFrameHqGeometry,
  buildRosterFrameHqGeometry,
  readHqGeometryFromOcrRawJson,
} from "@/lib/ocr/video-frame-hq-geometry.shared";

describe("video-frame-hq-geometry", () => {
  it("round-trips _hq geometry on ocr raw json", () => {
    const geometry = buildRosterFrameHqGeometry({
      sourceWidth: 1080,
      sourceHeight: 1920,
      entryCount: 12,
      rawLineCount: 40,
      durationMs: 120,
    });
    const wrapped = attachHqGeometryToOcrRawJson({ lines: ["a"] }, geometry);
    expect(readHqGeometryFromOcrRawJson(wrapped)?.entryCount).toBe(12);
    expect((wrapped as { lines: string[] }).lines).toEqual(["a"]);
  });

  it("flags deposit slip frames with zero slips", () => {
    const geometry = buildDepositSlipFrameHqGeometry({
      sourceWidth: 1080,
      sourceHeight: 1920,
      slipCount: 0,
      rawLineCount: 3,
      durationMs: 80,
    });
    expect(geometry.parsedOk).toBe(false);
    expect(geometry.failureCodes).toContain("too_few_ocr_lines");
  });

  it("aggregates dominant failure code across frames", () => {
    const summary = aggregateVideoJobHqGeometry([
      {
        frameIndex: 0,
        hq: buildRosterFrameHqGeometry({
          sourceWidth: 1080,
          sourceHeight: 1920,
          entryCount: 0,
          rawLineCount: 1,
          durationMs: 50,
          lowQuality: true,
        }),
      },
      {
        frameIndex: 1,
        hq: buildRosterFrameHqGeometry({
          sourceWidth: 1080,
          sourceHeight: 1920,
          entryCount: 0,
          rawLineCount: 2,
          durationMs: 60,
          lowQuality: true,
        }),
      },
      { frameIndex: 2, hq: null },
    ]);
    expect(summary.dominantFailureCode).toBe("too_few_ocr_lines");
    expect(summary.lowQualityFrameCount).toBe(2);
    expect(summary.framesWithGeometry).toBe(2);
  });
});
