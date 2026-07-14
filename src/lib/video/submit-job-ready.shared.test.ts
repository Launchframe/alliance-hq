import { describe, expect, it } from "vitest";

import {
  isVideoJobReadyForSubmit,
  resolveVideoSubmitRollbackStatus,
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

describe("resolveVideoSubmitRollbackStatus", () => {
  it("keeps complete when Update scores fails before Ashed wipe", () => {
    expect(
      resolveVideoSubmitRollbackStatus({
        originalStatus: "complete",
        clearedPriorAshedScores: false,
      }),
    ).toBe("complete");
  });

  it("forces review after Ashed wipe so the user must re-submit", () => {
    expect(
      resolveVideoSubmitRollbackStatus({
        originalStatus: "complete",
        clearedPriorAshedScores: true,
      }),
    ).toBe("review");
  });

  it("rolls first-submit failures back to review", () => {
    expect(
      resolveVideoSubmitRollbackStatus({
        originalStatus: "review",
        clearedPriorAshedScores: false,
      }),
    ).toBe("review");
  });
});
