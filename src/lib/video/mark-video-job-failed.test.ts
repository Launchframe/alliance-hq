import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockSet = vi.fn();
const mockWriteAuditLog = vi.fn();
const mockEmitVideoJobStatus = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
  }),
  schema: {
    videoJobs: {
      id: "id",
      sessionId: "sessionId",
      allianceId: "allianceId",
      fileName: "fileName",
      scoreTarget: "scoreTarget",
      category: "category",
      frameCount: "frameCount",
      uploadedFrameCount: "uploadedFrameCount",
      errorMessage: "errorMessage",
      status: "status",
      updatedAt: "updatedAt",
    },
  },
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

vi.mock("@/lib/events/video-jobs", () => ({
  emitVideoJobStatus: (...args: unknown[]) => mockEmitVideoJobStatus(...args),
}));

import { markVideoJobFailed } from "@/lib/video/mark-video-job-failed";

function mockJobRow(
  overrides: Partial<{
    id: string;
    sessionId: string;
    allianceId: string | null;
    status: string;
    errorMessage: string | null;
    fileName: string | null;
    scoreTarget: string | null;
    category: string | null;
    frameCount: number | null;
    uploadedFrameCount: number | null;
  }> = {},
) {
  return {
    id: "job-1",
    sessionId: "sess-1",
    allianceId: "ally-1",
    status: "queued",
    errorMessage: null,
    fileName: "clip.mp4",
    scoreTarget: "desert-storm",
    category: null,
    frameCount: null,
    uploadedFrameCount: 0,
    ...overrides,
  };
}

function setupDb(job: ReturnType<typeof mockJobRow> | null) {
  mockLimit.mockResolvedValue(job ? [job] : []);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });

  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockUpdate.mockReturnValue({ set: mockSet });
}

describe("markVideoJobFailed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates queued jobs to failed and emits SSE", async () => {
    setupDb(mockJobRow());

    const ok = await markVideoJobFailed("job-1", "sharp load failed");

    expect(ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorMessage: "sharp load failed",
      }),
    );
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "video.failed",
        resourceId: "job-1",
      }),
    );
    expect(mockEmitVideoJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        sessionId: "sess-1",
        status: "failed",
        errorMessage: "sharp load failed",
      }),
    );
  });

  it("re-emits SSE without duplicate audit when already failed", async () => {
    setupDb(
      mockJobRow({
        status: "failed",
        errorMessage: "same error",
      }),
    );

    const ok = await markVideoJobFailed("job-1", "same error");

    expect(ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
    expect(mockEmitVideoJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorMessage: "same error",
      }),
    );
  });

  it("returns false when job is missing", async () => {
    setupDb(null);

    const ok = await markVideoJobFailed("missing", "err");

    expect(ok).toBe(false);
    expect(mockEmitVideoJobStatus).not.toHaveBeenCalled();
  });
});
