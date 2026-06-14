import { describe, expect, it } from "vitest";

import {
  isActiveVideoJobStatus,
  isReviewReadyStatus,
  isTerminalVideoJobStatus,
  parseVideoJobStatusEvent,
} from "@/lib/events/video-jobs-types";

describe("video job status helpers", () => {
  it("detects active statuses", () => {
    expect(isActiveVideoJobStatus("queued")).toBe(true);
    expect(isActiveVideoJobStatus("extracting")).toBe(true);
    expect(isActiveVideoJobStatus("review")).toBe(false);
  });

  it("detects terminal statuses", () => {
    expect(isTerminalVideoJobStatus("review")).toBe(true);
    expect(isTerminalVideoJobStatus("failed")).toBe(true);
    expect(isTerminalVideoJobStatus("complete")).toBe(true);
    expect(isTerminalVideoJobStatus("queued")).toBe(false);
  });

  it("detects review-ready status", () => {
    expect(isReviewReadyStatus("review")).toBe(true);
    expect(isReviewReadyStatus("complete")).toBe(false);
  });
});

describe("parseVideoJobStatusEvent", () => {
  it("parses valid payloads", () => {
    expect(
      parseVideoJobStatusEvent(
        JSON.stringify({
          sessionId: "s1",
          jobId: "j1",
          status: "review",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).toMatchObject({ sessionId: "s1", jobId: "j1", status: "review" });
  });

  it("rejects invalid payloads", () => {
    expect(parseVideoJobStatusEvent("{")).toBeNull();
    expect(parseVideoJobStatusEvent(JSON.stringify({ jobId: "j1" }))).toBeNull();
  });
});
