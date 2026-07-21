import { describe, expect, it } from "vitest";

import {
  isActiveVideoJobStatus,
  isReviewReadyStatus,
  isTerminalVideoJobStatus,
  mergeVideoJobStatusEvent,
  parseVideoJobStatusEvent,
  type VideoJobStatusEvent,
} from "@/lib/events/video-jobs-types";

function baseEvent(
  overrides: Partial<VideoJobStatusEvent> = {},
): VideoJobStatusEvent {
  return {
    sessionId: "s1",
    jobId: "j1",
    status: "parsing",
    fileName: "clip.mp4",
    scoreTarget: "desert-storm",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

describe("mergeVideoJobStatusEvent", () => {
  it("returns next when there is no current event", () => {
    const next = baseEvent({ frameCount: 40 });
    expect(mergeVideoJobStatusEvent(undefined, next)).toBe(next);
  });

  it("keeps the newer updatedAt event", () => {
    const current = baseEvent({
      uploadedFrameCount: 5,
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    const older = baseEvent({
      uploadedFrameCount: 1,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(mergeVideoJobStatusEvent(current, older)).toBe(current);
  });

  it("does not let nullish frameCount/stage/ocrEngine wipe prior values", () => {
    const current = baseEvent({
      frameCount: 40,
      uploadedFrameCount: 10,
      stage: "ocr_running",
      ocrEngine: "ashed",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const next = baseEvent({
      frameCount: null,
      uploadedFrameCount: 12,
      stage: undefined,
      ocrEngine: undefined,
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    expect(mergeVideoJobStatusEvent(current, next)).toMatchObject({
      frameCount: 40,
      uploadedFrameCount: 12,
      stage: "ocr_running",
      ocrEngine: "ashed",
    });
  });

  it("re-resolves stage when status changes but next omits stage", () => {
    const current = baseEvent({
      status: "parsing",
      stage: "ocr_running",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const next = baseEvent({
      status: "review",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    expect(mergeVideoJobStatusEvent(current, next).stage).toBe("done");
  });

  it("allows an explicit uploadedFrameCount reset to zero", () => {
    const current = baseEvent({
      uploadedFrameCount: 40,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const next = baseEvent({
      uploadedFrameCount: 0,
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    expect(mergeVideoJobStatusEvent(current, next).uploadedFrameCount).toBe(0);
  });
});
