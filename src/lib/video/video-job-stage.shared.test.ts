import { describe, expect, it } from "vitest";

import {
  defaultStageForJobStatus,
  isIndeterminateVideoJobStage,
  resolveVideoJobStage,
  stageShowsPipelineLabel,
  videoJobEngineLabelKey,
  videoJobStageProgressPercent,
} from "@/lib/video/video-job-stage.shared";

describe("defaultStageForJobStatus", () => {
  it("maps every known video_jobs.status to a stage", () => {
    expect(defaultStageForJobStatus("queued")).toBe("queued");
    expect(defaultStageForJobStatus("pending_approval")).toBe(
      "awaiting_approval",
    );
    expect(defaultStageForJobStatus("extracting")).toBe("extracting_frames");
    expect(defaultStageForJobStatus("parsing")).toBe("ocr_running");
    expect(defaultStageForJobStatus("review")).toBe("done");
    expect(defaultStageForJobStatus("complete")).toBe("done");
    expect(defaultStageForJobStatus("failed")).toBe("failed");
  });

  it("returns null for unrecognized statuses", () => {
    expect(defaultStageForJobStatus("submitting")).toBeNull();
    expect(defaultStageForJobStatus("discarded")).toBeNull();
    expect(defaultStageForJobStatus("")).toBeNull();
  });
});

describe("resolveVideoJobStage", () => {
  it("prefers an explicit, valid stage over the status default", () => {
    expect(resolveVideoJobStage("parsing", "finalizing_rows")).toBe(
      "finalizing_rows",
    );
  });

  it("falls back to the status default when stage is missing", () => {
    expect(resolveVideoJobStage("parsing", null)).toBe("ocr_running");
    expect(resolveVideoJobStage("parsing", undefined)).toBe("ocr_running");
  });

  it("falls back to the status default when stage is not a known value", () => {
    // Guards against a future junk/legacy value on the wire crashing the UI.
    expect(resolveVideoJobStage("parsing", "not_a_real_stage")).toBe(
      "ocr_running",
    );
  });
});

describe("videoJobStageProgressPercent", () => {
  it("returns 0 for a null stage", () => {
    expect(videoJobStageProgressPercent(null)).toBe(0);
  });

  it("returns the band midpoint for stages without frame progress", () => {
    expect(videoJobStageProgressPercent("queued")).toBe(1);
    expect(videoJobStageProgressPercent("extracting_frames")).toBe(9);
    expect(videoJobStageProgressPercent("finalizing_rows")).toBe(91);
    expect(videoJobStageProgressPercent("done")).toBe(100);
  });

  it("interpolates within the ocr_running band using frame fraction", () => {
    expect(
      videoJobStageProgressPercent("ocr_running", { completed: 0, total: 40 }),
    ).toBe(15);
    expect(
      videoJobStageProgressPercent("ocr_running", { completed: 20, total: 40 }),
    ).toBe(50);
    expect(
      videoJobStageProgressPercent("ocr_running", { completed: 40, total: 40 }),
    ).toBe(85);
  });

  it("falls back to the band midpoint when ocr_running has no total yet", () => {
    expect(
      videoJobStageProgressPercent("ocr_running", { completed: 0, total: 0 }),
    ).toBe(50);
    expect(videoJobStageProgressPercent("ocr_running", null)).toBe(50);
  });

  it("clamps frame fractions outside [0, 1]", () => {
    // completed can momentarily exceed total by 0 at most in practice, but
    // stay defensive against out-of-range wire data.
    expect(
      videoJobStageProgressPercent("ocr_running", {
        completed: 999,
        total: 40,
      }),
    ).toBe(85);
    expect(
      videoJobStageProgressPercent("ocr_running", {
        completed: -5,
        total: 40,
      }),
    ).toBe(15);
  });
});

describe("isIndeterminateVideoJobStage", () => {
  it("is indeterminate for stages with no frame-level counter", () => {
    expect(isIndeterminateVideoJobStage("queued")).toBe(true);
    expect(isIndeterminateVideoJobStage("awaiting_approval")).toBe(true);
    expect(isIndeterminateVideoJobStage("extracting_frames")).toBe(true);
    expect(isIndeterminateVideoJobStage("finalizing_rows")).toBe(true);
  });

  it("ocr_running is determinate once a frame total is known", () => {
    expect(
      isIndeterminateVideoJobStage("ocr_running", { completed: 0, total: 10 }),
    ).toBe(false);
  });

  it("ocr_running is indeterminate before the frame total is known", () => {
    expect(isIndeterminateVideoJobStage("ocr_running", null)).toBe(true);
    expect(
      isIndeterminateVideoJobStage("ocr_running", { completed: 0, total: 0 }),
    ).toBe(true);
  });

  it("done/failed are not indeterminate (fixed 100%/0% fill)", () => {
    expect(isIndeterminateVideoJobStage("done")).toBe(false);
    expect(isIndeterminateVideoJobStage("failed")).toBe(false);
  });
});

describe("videoJobEngineLabelKey", () => {
  it("maps known engines to their videoReview message key", () => {
    expect(videoJobEngineLabelKey("ashed")).toBe("engineAshed");
    expect(videoJobEngineLabelKey("native")).toBe("engineNative");
    expect(videoJobEngineLabelKey("mock")).toBe("engineMock");
  });

  it("returns null for unknown or missing engines", () => {
    expect(videoJobEngineLabelKey(null)).toBeNull();
    expect(videoJobEngineLabelKey(undefined)).toBeNull();
    expect(videoJobEngineLabelKey("opencv")).toBeNull();
  });
});

describe("stageShowsPipelineLabel", () => {
  it("shows the pipeline label only while a pipeline is actually doing work", () => {
    expect(stageShowsPipelineLabel("extracting_frames")).toBe(true);
    expect(stageShowsPipelineLabel("ocr_running")).toBe(true);
    expect(stageShowsPipelineLabel("finalizing_rows")).toBe(true);
  });

  it("hides the pipeline label for queue/approval/terminal stages", () => {
    expect(stageShowsPipelineLabel("queued")).toBe(false);
    expect(stageShowsPipelineLabel("awaiting_approval")).toBe(false);
    expect(stageShowsPipelineLabel("done")).toBe(false);
    expect(stageShowsPipelineLabel("failed")).toBe(false);
    expect(stageShowsPipelineLabel(null)).toBe(false);
  });
});
