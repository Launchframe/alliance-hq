import { describe, expect, it } from "vitest";

import { shouldRefetchOnLiveJobStatus } from "./live-job-refresh.shared";

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

  it("does not refetch on the first observed status (mount handles initial load)", () => {
    expect(shouldRefetchOnLiveJobStatus(null, "review")).toBe(false);
    expect(shouldRefetchOnLiveJobStatus(null, "failed")).toBe(false);
  });

  it("does not refetch for non-terminal statuses", () => {
    expect(shouldRefetchOnLiveJobStatus("queued", "parsing")).toBe(false);
    expect(shouldRefetchOnLiveJobStatus("review", "parsing")).toBe(false);
    expect(shouldRefetchOnLiveJobStatus(null, "queued")).toBe(false);
  });

  it("refetches when a job flips between failed and review", () => {
    expect(shouldRefetchOnLiveJobStatus("failed", "review")).toBe(true);
    expect(shouldRefetchOnLiveJobStatus("review", "failed")).toBe(true);
  });
});
