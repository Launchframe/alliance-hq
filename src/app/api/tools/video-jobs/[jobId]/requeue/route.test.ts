import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSessionId: vi.fn(),
  requireAllianceVideoJobOps: vi.fn(),
  isAllianceVideoJobOpsDenied: vi.fn(),
  loadAllianceScopedVideoJob: vi.fn(),
  updateReturning: vi.fn(),
  selectLimit: vi.fn(),
  dispatchVideoProcessing: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  readSessionId: mocks.readSessionId,
}));
vi.mock("@/lib/video/alliance-video-jobs-access.server", () => ({
  requireAllianceVideoJobOps: mocks.requireAllianceVideoJobOps,
  isAllianceVideoJobOpsDenied: mocks.isAllianceVideoJobOpsDenied,
  loadAllianceScopedVideoJob: mocks.loadAllianceScopedVideoJob,
}));
vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing: mocks.dispatchVideoProcessing,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mocks.updateReturning,
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.selectLimit,
        }),
      }),
    }),
  }),
  schema: {
    videoJobs: { id: "id", status: "status" },
  },
}));

import { POST } from "./route";

const request = (jobId = "job-1") =>
  POST(new Request("http://localhost/requeue"), {
    params: Promise.resolve({ jobId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSessionId.mockResolvedValue("session-1");
  mocks.requireAllianceVideoJobOps.mockResolvedValue({ allianceId: "a1" });
  mocks.isAllianceVideoJobOpsDenied.mockReturnValue(false);
  mocks.loadAllianceScopedVideoJob.mockResolvedValue({
    ok: true,
    job: { id: "job-1", status: "queued" },
  });
  mocks.updateReturning.mockResolvedValue([{ id: "job-1" }]);
  mocks.dispatchVideoProcessing.mockResolvedValue(undefined);
});

describe("POST /api/tools/video-jobs/[jobId]/requeue", () => {
  it("CAS-claims queued|failed → queued then dispatches", async () => {
    const res = await request();
    expect(res.status).toBe(200);
    expect(mocks.updateReturning).toHaveBeenCalled();
    expect(mocks.dispatchVideoProcessing).toHaveBeenCalledWith("job-1", {
      source: "admin-requeue",
    });
  });

  it("returns 409 without dispatch when CAS loses to worker claim", async () => {
    mocks.updateReturning.mockResolvedValue([]);
    mocks.selectLimit.mockResolvedValue([{ status: "extracting" }]);
    const res = await request();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("extracting"),
    });
    expect(mocks.dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("rejects review jobs before attempting CAS", async () => {
    mocks.loadAllianceScopedVideoJob.mockResolvedValue({
      ok: true,
      job: { id: "job-1", status: "review" },
    });
    const res = await request();
    expect(res.status).toBe(409);
    expect(mocks.updateReturning).not.toHaveBeenCalled();
    expect(mocks.dispatchVideoProcessing).not.toHaveBeenCalled();
  });
});
