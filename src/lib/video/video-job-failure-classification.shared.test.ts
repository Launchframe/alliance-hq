import { describe, expect, it } from "vitest";

import {
  STALE_IN_FLIGHT_FAILURE_MESSAGE,
  classifyVideoJobFailure,
  videoJobFailureReviewMessageKey,
} from "@/lib/video/video-job-failure-classification.shared";

describe("classifyVideoJobFailure", () => {
  it("classifies the stale worker timeout message as retryable", () => {
    expect(classifyVideoJobFailure(STALE_IN_FLIGHT_FAILURE_MESSAGE)).toEqual({
      audience: "retryable",
      reasonKey: "stale_worker_timeout",
    });
  });

  it("defaults empty or whitespace messages to needs platform attention", () => {
    expect(classifyVideoJobFailure(null)).toEqual({
      audience: "needs_platform_attention",
      reasonKey: "missing_error_message",
    });
    expect(classifyVideoJobFailure("")).toEqual({
      audience: "needs_platform_attention",
      reasonKey: "missing_error_message",
    });
    expect(classifyVideoJobFailure("   ")).toEqual({
      audience: "needs_platform_attention",
      reasonKey: "missing_error_message",
    });
  });

  it("treats unrecognized exception text as needs platform attention", () => {
    expect(
      classifyVideoJobFailure("Vercel Runtime Timeout Error: Task timed out after 300 seconds"),
    ).toEqual({
      audience: "needs_platform_attention",
      reasonKey: "unknown",
    });
  });
});

describe("videoJobFailureReviewMessageKey", () => {
  it("maps retryable failures to processingFailedRetryable", () => {
    expect(
      videoJobFailureReviewMessageKey(
        classifyVideoJobFailure(STALE_IN_FLIGHT_FAILURE_MESSAGE),
      ),
    ).toBe("processingFailedRetryable");
  });

  it("maps platform failures to processingFailedPlatform", () => {
    expect(
      videoJobFailureReviewMessageKey(classifyVideoJobFailure("508 INFINITE_LOOP_DETECTED")),
    ).toBe("processingFailedPlatform");
  });
});
