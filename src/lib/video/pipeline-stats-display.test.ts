import { describe, expect, it } from "vitest";

import {
  buildPipelineStatsSections,
  computeFramesSkipped,
  estimateDenseFrameCount,
  formatPipelineDuration,
  frameSkipRatePercent,
  isVideoProcessTimings,
  ocrOverlapPercent,
  ocrWallMs,
  shouldShowExtractionQualitySection,
  sumPhaseMs,
} from "@/lib/video/pipeline-stats-display";

describe("pipeline-stats-display", () => {
  it("formats durations", () => {
    expect(formatPipelineDuration(450)).toBe("450ms");
    expect(formatPipelineDuration(16314)).toBe("16.3s");
    expect(formatPipelineDuration(null)).toBe("—");
  });

  it("sums phase groups", () => {
    const phases = {
      "storage.load_video": 2,
      "ffmpeg.extract": 356,
      "ashed.ocr_total": 15316,
      "ashed.upload": 8111,
    };
    expect(sumPhaseMs(phases, ["storage.load_video", "ffmpeg.extract"])).toBe(
      358,
    );
    expect(ocrWallMs(phases)).toBe(15316);
  });

  it("builds mental-model sections", () => {
    const timings = {
      jobId: "j1",
      scoreTarget: "zombie-siege",
      fileSizeBytes: 1000,
      frameCount: 8,
      rowCount: 24,
      matchedCount: 20,
      totalMs: 16314,
      phases: {
        "storage.load_video": 2,
        "ffmpeg.extract": 356,
        "alliance.resolve": 352,
        "ashed.ocr_total": 15316,
        "ashed.upload": 8111,
        "parse.match_and_persist": 34,
      },
      ocrFrameMs: [7000, 7000],
      ocrFrameAvgMs: 7000,
      ocrConcurrency: 4,
      ashedUploadTotalMs: 8111,
      ashedExtractTotalMs: 48000,
    };
    const sections = buildPipelineStatsSections(timings);
    expect(sections.find((s) => s.id === "ocr")?.wallMs).toBe(15316);
    expect(sections.find((s) => s.id === "extract")?.wallMs).toBe(358);
  });

  it("validates timings shape", () => {
    expect(isVideoProcessTimings(null)).toBe(false);
    expect(isVideoProcessTimings({ totalMs: 1, phases: {} })).toBe(true);
  });

  describe("extraction quality metrics", () => {
    it("estimates dense frame count with ceil(duration * 2)", () => {
      expect(estimateDenseFrameCount(10)).toBe(20);
      expect(estimateDenseFrameCount(10.1)).toBe(21);
      expect(estimateDenseFrameCount(0.4)).toBe(1);
    });

    it("computes frames skipped vs selected count", () => {
      expect(computeFramesSkipped(20, 8)).toBe(12);
      expect(computeFramesSkipped(8, 10)).toBe(0);
      expect(computeFramesSkipped(null, 8)).toBeNull();
    });

    it("formats skip rate without divide-by-zero", () => {
      expect(frameSkipRatePercent(12, 20)).toBe(60);
      expect(frameSkipRatePercent(0, 20)).toBe(0);
      expect(frameSkipRatePercent(1, 0)).toBeNull();
      expect(frameSkipRatePercent(null, 20)).toBeNull();
    });

    it("formats OCR overlap percent", () => {
      expect(ocrOverlapPercent(100, 40)).toBe(60);
      expect(ocrOverlapPercent(40, 40)).toBe(0);
      expect(ocrOverlapPercent(0, 0)).toBeNull();
    });

    it("shows extraction section only when phase-3 fields exist", () => {
      expect(
        shouldShowExtractionQualitySection({
          videoDurationSeconds: null,
          denseFrameCount: null,
          totalRawOcrRows: null,
        }),
      ).toBe(false);
      expect(
        shouldShowExtractionQualitySection({
          videoDurationSeconds: 12.5,
          denseFrameCount: 25,
          totalRawOcrRows: null,
        }),
      ).toBe(true);
      expect(
        shouldShowExtractionQualitySection({
          videoDurationSeconds: null,
          denseFrameCount: null,
          totalRawOcrRows: 48,
        }),
      ).toBe(true);
    });
  });
});
