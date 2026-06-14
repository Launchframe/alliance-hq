import { describe, expect, it } from "vitest";

import {
  canReprocessVideoJob,
  canRequeueVideoJob,
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
