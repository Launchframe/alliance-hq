import { describe, expect, it } from "vitest";

import {
  isVideoJobReadyForSubmit,
  VIDEO_SUBMIT_IN_PROGRESS_ERROR,
  videoSubmitClaimLostError,
  videoSubmitNotReadyError,
} from "./submit-job-ready.shared";

describe("isVideoJobReadyForSubmit", () => {
  it("allows review and complete", () => {
    expect(isVideoJobReadyForSubmit("review")).toBe(true);
    expect(isVideoJobReadyForSubmit("complete")).toBe(true);
  });

  it("rejects other statuses", () => {
    expect(isVideoJobReadyForSubmit("submitting")).toBe(false);
    expect(isVideoJobReadyForSubmit("discarded")).toBe(false);
    expect(isVideoJobReadyForSubmit("queued")).toBe(false);
  });
});

describe("submit readiness error copy", () => {
  it("includes the job status in not-ready and claim-lost messages", () => {
    expect(videoSubmitNotReadyError("discarded")).toBe(
      `Can't submit — this job's status is "discarded". Refresh the page. Only jobs in review can be submitted.`,
    );
    expect(videoSubmitClaimLostError("submitting")).toBe(
      `Couldn't start submit — this job's status is now "submitting". Refresh the page and try again.`,
    );
    expect(VIDEO_SUBMIT_IN_PROGRESS_ERROR).toBe("Submit already in progress.");
  });
});
