import { describe, expect, it } from "vitest";

import {
  isActiveQueueVideoJobStatus,
  isHiddenFromActiveQueue,
  isInFlightProcessingStatus,
  isVideoJobFailProtectedStatus,
  VIDEO_JOB_FAIL_PROTECTED_STATUSES,
  videoJobLifecycleStage,
} from "@/lib/video/video-lifecycle.shared";

describe("video lifecycle queue helpers", () => {
  it("lists active queue statuses", () => {
    expect(isActiveQueueVideoJobStatus("pending_upload")).toBe(true);
    expect(isActiveQueueVideoJobStatus("pending_approval")).toBe(true);
    expect(isActiveQueueVideoJobStatus("review")).toBe(true);
    expect(isActiveQueueVideoJobStatus("failed")).toBe(true);
    expect(isActiveQueueVideoJobStatus("complete")).toBe(false);
  });

  it("hides terminal statuses from active queue", () => {
    expect(isHiddenFromActiveQueue("complete")).toBe(true);
    expect(isHiddenFromActiveQueue("submitted")).toBe(true);
    expect(isHiddenFromActiveQueue("discarded")).toBe(true);
    expect(isHiddenFromActiveQueue("review")).toBe(false);
  });

  it("maps lifecycle stages", () => {
    expect(videoJobLifecycleStage("pending_upload")).toBe("needs_upload");
    expect(videoJobLifecycleStage("pending_approval")).toBe("needs_approval");
    expect(videoJobLifecycleStage("parsing")).toBe("processing");
    expect(videoJobLifecycleStage("review")).toBe("ready_to_review");
    expect(videoJobLifecycleStage("submitting")).toBe("submitting");
    expect(videoJobLifecycleStage("failed")).toBe("needs_attention");
    expect(videoJobLifecycleStage("complete")).toBeNull();
  });

  it("detects in-flight processing", () => {
    expect(isInFlightProcessingStatus("queued")).toBe(true);
    expect(isInFlightProcessingStatus("extracting")).toBe(true);
    expect(isInFlightProcessingStatus("review")).toBe(false);
  });
});

describe("isVideoJobFailProtectedStatus", () => {
  it("protects successful and operator-owned statuses from fail overwrites", () => {
    for (const status of VIDEO_JOB_FAIL_PROTECTED_STATUSES) {
      expect(isVideoJobFailProtectedStatus(status)).toBe(true);
    }
    for (const status of ["queued", "extracting", "parsing", "failed"]) {
      expect(isVideoJobFailProtectedStatus(status)).toBe(false);
    }
  });
});
