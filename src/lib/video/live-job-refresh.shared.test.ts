import { describe, expect, it } from "vitest";

import {
  isTerminalLiveJobStatus,
  shouldRefetchOnLiveJobStatus,
} from "./live-job-refresh.shared";

describe("isTerminalLiveJobStatus", () => {
  it("is true only for review and failed", () => {
    expect(isTerminalLiveJobStatus("review")).toBe(true);
    expect(isTerminalLiveJobStatus("failed")).toBe(true);
    expect(isTerminalLiveJobStatus("complete")).toBe(false);
    expect(isTerminalLiveJobStatus("discarded")).toBe(false);
    expect(isTerminalLiveJobStatus("parsing")).toBe(false);
  });
});

describe("shouldRefetchOnLiveJobStatus", () => {
  it("refetches when transitioning from a processing status into review", () => {
    expect(shouldRefetchOnLiveJobStatus("parsing", "review")).toBe(true);
    expect(shouldRefetchOnLiveJobStatus("extracting", "review")).toBe(true);
    expect(shouldRefetchOnLiveJobStatus("queued", "failed")).toBe(true);
  });

  it("does not refetch on repeated snapshots of the same review status", () => {
    // This is the core bug: SSE re-emits review snapshots while the user edits.
    expect(shouldRefetchOnLiveJobStatus("review", "review")).toBe(false);
    expect(shouldRefetchOnLiveJobStatus("failed", "failed")).toBe(false);
  });

  it("does not refetch on the first observed terminal status when REST is already terminal", () => {
    // Mount load already fetched review/failed; SSE snapshot must not clobber edits.
    expect(shouldRefetchOnLiveJobStatus(null, "review")).toBe(false);
    expect(shouldRefetchOnLiveJobStatus(null, "failed")).toBe(false);
    expect(
      shouldRefetchOnLiveJobStatus(null, "review", { restStatus: "review" }),
    ).toBe(false);
    expect(
      shouldRefetchOnLiveJobStatus(null, "failed", { restStatus: "failed" }),
    ).toBe(false);
  });

  it("refetches on the first observed terminal status while REST is still active", () => {
    // Page opened mid-flight; first SSE lands after OCR finished.
    expect(
      shouldRefetchOnLiveJobStatus(null, "review", { restStatus: "parsing" }),
    ).toBe(true);
    expect(
      shouldRefetchOnLiveJobStatus(null, "failed", {
        restStatus: "extracting",
      }),
    ).toBe(true);
    expect(
      shouldRefetchOnLiveJobStatus(null, "review", { restStatus: "queued" }),
    ).toBe(true);
  });

  it("does not refetch for non-terminal statuses", () => {
    expect(shouldRefetchOnLiveJobStatus("queued", "parsing")).toBe(false);
    expect(shouldRefetchOnLiveJobStatus("review", "parsing")).toBe(false);
    expect(shouldRefetchOnLiveJobStatus(null, "queued")).toBe(false);
    expect(
      shouldRefetchOnLiveJobStatus(null, "parsing", { restStatus: "parsing" }),
    ).toBe(false);
  });

  it("refetches when a job flips between failed and review", () => {
    expect(shouldRefetchOnLiveJobStatus("failed", "review")).toBe(true);
    expect(shouldRefetchOnLiveJobStatus("review", "failed")).toBe(true);
  });
});
