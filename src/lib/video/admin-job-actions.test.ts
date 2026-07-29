import { describe, expect, it } from "vitest";

import {
  canReprocessVideoJob,
  canRequeueVideoJob,
  resolveReprocessGateStatus,
} from "@/lib/video/admin-job-actions";

describe("canRequeueVideoJob", () => {
  it("allows requeue for queued and failed jobs", () => {
    expect(canRequeueVideoJob("queued")).toBe(true);
    expect(canRequeueVideoJob("failed")).toBe(true);
  });

  it("blocks requeue while processing or after review", () => {
    expect(canRequeueVideoJob("extracting")).toBe(false);
    expect(canRequeueVideoJob("parsing")).toBe(false);
    expect(canRequeueVideoJob("review")).toBe(false);
  });
});

describe("canReprocessVideoJob", () => {
  it("allows reprocess when not in flight", () => {
    expect(canReprocessVideoJob("failed")).toBe(true);
    expect(canReprocessVideoJob("review")).toBe(true);
    expect(canReprocessVideoJob("queued")).toBe(true);
  });

  it("blocks reprocess while extracting or parsing", () => {
    expect(canReprocessVideoJob("extracting")).toBe(false);
    expect(canReprocessVideoJob("parsing")).toBe(false);
  });
});

describe("resolveReprocessGateStatus", () => {
  it("prefers live SSE status over stale REST status", () => {
    expect(resolveReprocessGateStatus("queued", "parsing")).toBe("parsing");
    expect(resolveReprocessGateStatus("queued", "extracting")).toBe(
      "extracting",
    );
  });

  it("falls back to REST when live status is absent", () => {
    expect(resolveReprocessGateStatus("review", null)).toBe("review");
    expect(resolveReprocessGateStatus("failed", undefined)).toBe("failed");
  });
});
