import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const requireApiSession = vi.fn();
const getAshedConnection = vi.fn();
const sessionCanProcessVideo = vi.fn();
const loadEffectiveAllianceHqOcrOnly = vi.fn();
const resetVideoJobForReprocess = vi.fn();
const dispatchVideoProcessing = vi.fn();
const writeAuditLog = vi.fn();
const updateWhere = vi.fn().mockResolvedValue(undefined);
const selectLimit = vi.fn();

const assertJobVideoStorageAvailable = vi.fn();

vi.mock("@/lib/video/assert-job-video-storage.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/video/assert-job-video-storage.server")
    >();
  return {
    ...actual,
    assertJobVideoStorageAvailable: (...args: unknown[]) =>
      assertJobVideoStorageAvailable(...args),
  };
});

import { VideoJobStorageUnavailableError } from "@/lib/video/assert-job-video-storage.server";

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => requireApiSession(...args),
  getAshedConnection: (...args: unknown[]) => getAshedConnection(...args),
}));

vi.mock("@/lib/video/processor-slots.server", () => ({
  sessionCanProcessVideo: (...args: unknown[]) =>
    sessionCanProcessVideo(...args),
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
    update: () => ({
      set: () => ({
        where: (...args: unknown[]) => updateWhere(...args),
      }),
    }),
  }),
  schema: {
    videoJobs: {
      id: "id",
      allianceId: "alliance_id",
    },
  },
}));

vi.mock("@/lib/video/alliance-ocr-settings.server", () => ({
  loadEffectiveAllianceHqOcrOnly: (...args: unknown[]) =>
    loadEffectiveAllianceHqOcrOnly(...args),
}));

vi.mock("@/lib/video/reset-video-job-for-reprocess", () => ({
  resetVideoJobForReprocess: (...args: unknown[]) =>
    resetVideoJobForReprocess(...args),
  VideoJobReprocessConflictError: class VideoJobReprocessConflictError extends Error {
    readonly statusCode = 409;
    constructor(status: string) {
      super(
        `Cannot reprocess job in status "${status}" while processing is in flight.`,
      );
      this.name = "VideoJobReprocessConflictError";
    }
  },
}));

vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing: (...args: unknown[]) =>
    dispatchVideoProcessing(...args),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));

const SESSION = {
  id: "sess-1",
  hqUserId: "hq-1",
  currentAllianceId: "ally-1",
};

describe("POST /api/tools/video-upload/[jobId]/reprocess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadEffectiveAllianceHqOcrOnly.mockResolvedValue(false);
    resetVideoJobForReprocess.mockResolvedValue(undefined);
    writeAuditLog.mockResolvedValue(undefined);
    updateWhere.mockResolvedValue(undefined);
    assertJobVideoStorageAvailable.mockResolvedValue("videos/job-1/source.mp4");
  });

  it("skips Ashed for native-only deposit-slip targets and queues async", async () => {
    requireApiSession.mockResolvedValue(SESSION);
    sessionCanProcessVideo.mockResolvedValue(true);
    selectLimit.mockResolvedValue([
      {
        id: "job-1",
        allianceId: "ally-1",
        scoreTarget: "bank-deposit-slip-history",
        category: "bank-deposit-slip-history",
        fileName: "slip.mp4",
        enqueuedByHqUserId: "hq-uploader",
        status: "review",
      },
    ]);

    const res = await POST(new Request("http://localhost/reprocess"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      jobId: "job-1",
      status: "queued",
    });
    expect(getAshedConnection).not.toHaveBeenCalled();
    expect(resetVideoJobForReprocess).toHaveBeenCalledWith("job-1", {
      processorBinding: {
        processingSessionId: "sess-1",
        approvedByHqUserId: "hq-1",
        approvedAt: expect.any(Date),
      },
    });
    expect(dispatchVideoProcessing).toHaveBeenCalledWith("job-1", {
      source: "reprocess",
    });
  });

  it("returns connectUrl with review next for Ashed-required targets", async () => {
    requireApiSession.mockResolvedValue(SESSION);
    sessionCanProcessVideo.mockResolvedValue(true);
    getAshedConnection.mockResolvedValue(null);
    selectLimit.mockResolvedValue([
      {
        id: "job-2",
        allianceId: "ally-1",
        scoreTarget: "desert-storm",
        category: "desert-storm",
        fileName: "ds.mp4",
        enqueuedByHqUserId: "hq-uploader",
        status: "review",
      },
    ]);

    const res = await POST(new Request("http://localhost/reprocess"), {
      params: Promise.resolve({ jobId: "job-2" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ashed_not_connected");
    expect(body.connectUrl).toBe(
      "/connect?next=%2Ftools%2Fvideo-upload%2Fjob-2%2Freview",
    );
  });

  it("forwards processor-slot denial", async () => {
    requireApiSession.mockResolvedValue(SESSION);
    sessionCanProcessVideo.mockResolvedValue(false);

    const res = await POST(new Request("http://localhost/reprocess"), {
      params: Promise.resolve({ jobId: "job-x" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 and skips reset when source video is missing", async () => {
    requireApiSession.mockResolvedValue(SESSION);
    sessionCanProcessVideo.mockResolvedValue(true);
    selectLimit.mockResolvedValue([
      {
        id: "job-4",
        allianceId: "ally-1",
        scoreTarget: "bank-deposit-slip-history",
        category: "bank-deposit-slip-history",
        fileName: "slip.mp4",
        enqueuedByHqUserId: "hq-uploader",
        status: "review",
        storageKey: "videos/shadow/source.mp4",
        archiveStorageKey: null,
        groupId: "group-1",
      },
    ]);
    assertJobVideoStorageAvailable.mockRejectedValue(
      new VideoJobStorageUnavailableError(
        "The source video is no longer in storage. Reprocess the primary pass or re-upload the clip.",
      ),
    );

    const res = await POST(new Request("http://localhost/reprocess"), {
      params: Promise.resolve({ jobId: "job-4" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error:
        "The source video is no longer in storage. Reprocess the primary pass or re-upload the clip.",
    });
    expect(assertJobVideoStorageAvailable).toHaveBeenCalledWith({
      storageKey: "videos/shadow/source.mp4",
      archiveStorageKey: null,
      groupId: "group-1",
      fileName: "slip.mp4",
    });
    expect(resetVideoJobForReprocess).not.toHaveBeenCalled();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("returns 409 when job is submitting", async () => {
    requireApiSession.mockResolvedValue(SESSION);
    sessionCanProcessVideo.mockResolvedValue(true);
    selectLimit.mockResolvedValue([
      {
        id: "job-3",
        allianceId: "ally-1",
        scoreTarget: "bank-deposit-slip-history",
        category: "bank-deposit-slip-history",
        fileName: "slip.mp4",
        enqueuedByHqUserId: "hq-uploader",
        status: "submitting",
      },
    ]);

    const res = await POST(new Request("http://localhost/reprocess"), {
      params: Promise.resolve({ jobId: "job-3" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        'Cannot reprocess job in status "submitting" while processing is in flight.',
    });
    expect(resetVideoJobForReprocess).not.toHaveBeenCalled();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });
});
