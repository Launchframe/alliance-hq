import { describe, expect, it } from "vitest";

import { isVideoWorkerAllowedPath } from "@/lib/video/video-worker-mode.shared";

describe("isVideoWorkerAllowedPath", () => {
  it("allows health, process, and archive internal routes", () => {
    expect(isVideoWorkerAllowedPath("/api/internal/video-worker/health")).toBe(
      true,
    );
    expect(
      isVideoWorkerAllowedPath("/api/internal/video-process/job-1"),
    ).toBe(true);
    expect(
      isVideoWorkerAllowedPath("/api/internal/video-process/queue"),
    ).toBe(true);
    expect(
      isVideoWorkerAllowedPath("/api/internal/video-archive/job-1"),
    ).toBe(true);
  });

  it("rejects public HQ and unrelated API paths", () => {
    expect(isVideoWorkerAllowedPath("/")).toBe(false);
    expect(isVideoWorkerAllowedPath("/en-US/tools/video-upload")).toBe(false);
    expect(isVideoWorkerAllowedPath("/api/tools/video-upload")).toBe(false);
    expect(isVideoWorkerAllowedPath("/api/webhooks/discord/interactions")).toBe(
      false,
    );
  });
});
