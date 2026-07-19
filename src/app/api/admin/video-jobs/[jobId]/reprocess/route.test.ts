import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const readSessionId = vi.fn();
const requirePlatformMaintainer = vi.fn();
const selectLimit = vi.fn();
const adminReprocessVideoJob = vi.fn();
const dispatchVideoProcessing = vi.fn();

vi.mock("@/lib/session", () => ({
  readSessionId: (...args: unknown[]) => readSessionId(...args),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requirePlatformMaintainer: (...args: unknown[]) =>
    requirePlatformMaintainer(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => selectLimit(...args),
        }),
      }),
    }),
  }),
  schema: {
    videoJobs: {
      id: "id",
      status: "status",
    },
  },
}));

vi.mock("@/lib/video/admin-reprocess-extraction.server", () => ({
  AdminReprocessError: class AdminReprocessError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = "AdminReprocessError";
    }
  },
  adminReprocessVideoJob: (...args: unknown[]) =>
    adminReprocessVideoJob(...args),
}));

vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing: (...args: unknown[]) =>
    dispatchVideoProcessing(...args),
}));

describe("POST /api/admin/video-jobs/[jobId]/reprocess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionId.mockResolvedValue("sess-1");
    requirePlatformMaintainer.mockResolvedValue(null);
    selectLimit.mockResolvedValue([{ id: "job-1", status: "failed" }]);
    adminReprocessVideoJob.mockResolvedValue({
      jobId: "job-1",
      status: "queued",
      previousPassKey: "fps_3",
      nextPassKey: "fps_4",
      changed: true,
      campaignId: "camp-1",
      armId: "arm-1",
    });
  });

  it("forwards JSON body and dispatches processing", async () => {
    const res = await POST(
      new Request("http://localhost/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment: "increase" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      jobId: "job-1",
      nextPassKey: "fps_4",
    });
    expect(adminReprocessVideoJob).toHaveBeenCalledWith({
      jobId: "job-1",
      sessionId: "sess-1",
      body: { adjustment: "increase" },
    });
    expect(dispatchVideoProcessing).toHaveBeenCalledWith("job-1", {
      source: "reprocess",
    });
  });

  it("defaults empty body when content-type is not JSON", async () => {
    const res = await POST(new Request("http://localhost/reprocess", {
      method: "POST",
    }), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(200);
    expect(adminReprocessVideoJob).toHaveBeenCalledWith({
      jobId: "job-1",
      sessionId: "sess-1",
      body: {},
    });
  });

  it("rejects in-flight statuses", async () => {
    selectLimit.mockResolvedValue([{ id: "job-1", status: "extracting" }]);
    const res = await POST(
      new Request("http://localhost/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment: "keep" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    expect(res.status).toBe(409);
    expect(adminReprocessVideoJob).not.toHaveBeenCalled();
  });

  it("maps AdminReprocessError to JSON status", async () => {
    const { AdminReprocessError } = await import(
      "@/lib/video/admin-reprocess-extraction.server"
    );
    adminReprocessVideoJob.mockRejectedValue(
      new AdminReprocessError('adjustment must be "keep", "increase", or "decrease".', 400),
    );
    const res = await POST(
      new Request("http://localhost/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment: "nope" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'adjustment must be "keep", "increase", or "decrease".',
    });
  });

  it("maps in-flight AdminReprocessError to 409 after route gate", async () => {
    const { AdminReprocessError } = await import(
      "@/lib/video/admin-reprocess-extraction.server"
    );
    adminReprocessVideoJob.mockRejectedValue(
      new AdminReprocessError(
        'Cannot reprocess job in status "extracting" while processing is in flight.',
        409,
      ),
    );
    const res = await POST(
      new Request("http://localhost/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment: "increase" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    expect(res.status).toBe(409);
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });
});
