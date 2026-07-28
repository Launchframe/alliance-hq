import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectLimit = vi.fn();
const mockSelectOrderBy = vi.fn();
const mockUpdateReturning = vi.fn();
const mockUpdateWhere = vi.fn();
const mockInsertValues = vi.fn();
const mockGetObject = vi.fn();
const mockPreprocess = vi.fn();
const mockTesseract = vi.fn();
const mockDispatch = vi.fn();
const mockCompare = vi.fn();
const mockEmit = vi.fn();
const mockTrackTimings = vi.fn();
const mockTrackFailure = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("nanoid", () => ({ nanoid: () => "nano-1" }));

vi.mock("@/lib/storage", () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args),
}));

vi.mock("@/lib/members/roster-ocr/preprocess", () => ({
  preprocessRosterImage: (...args: unknown[]) => mockPreprocess(...args),
}));

vi.mock("@/lib/members/roster-ocr/tesseract", () => ({
  runTesseract: (...args: unknown[]) => mockTesseract(...args),
}));

vi.mock("@/lib/members/roster-ocr/types", () => ({
  DEFAULT_ROSTER_OCR_CONFIG: {},
}));

vi.mock("@/lib/events/video-jobs", () => ({
  emitVideoJobStatus: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing: (...args: unknown[]) => mockDispatch(...args),
}));

vi.mock("@/lib/banks/deposit-slip-ocr/deposit-slip-shadow-comparison.server", () => ({
  maybeCompareDepositSlipFingerprintShadow: (...args: unknown[]) =>
    mockCompare(...args),
}));

vi.mock("@/lib/analytics/video-pipeline", () => ({
  trackVideoPipelineTimings: (...args: unknown[]) => mockTrackTimings(...args),
  trackVideoPipelineFailure: (...args: unknown[]) => mockTrackFailure(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockSelectLimit(...args),
          orderBy: (...args: unknown[]) => mockSelectOrderBy(...args),
        }),
      }),
    }),
    update: () => ({
      set: (payload: unknown) => ({
        where: (condition: unknown) => {
          mockUpdateWhere(payload, condition);
          return {
            returning: (...args: unknown[]) => mockUpdateReturning(...args),
          };
        },
      }),
    }),
    insert: () => ({
      values: (payload: unknown) => mockInsertValues(payload),
    }),
  }),
  schema: {
    videoJobs: {
      id: "videoJobs.id",
      status: "videoJobs.status",
      allianceId: "videoJobs.allianceId",
    },
    videoFrames: {
      frameIndex: "videoFrames.frameIndex",
      storageKey: "videoFrames.storageKey",
      jobId: "videoFrames.jobId",
    },
    videoUploadGroups: {
      id: "videoUploadGroups.id",
      primaryJobId: "videoUploadGroups.primaryJobId",
      boardKey: "videoUploadGroups.boardKey",
      hqEventId: "videoUploadGroups.hqEventId",
    },
    parseSessions: {},
    parsedRows: {},
  },
}));

import { processDepositSlipFingerprintShadowJob } from "@/lib/video/process-deposit-slip-fingerprint-shadow-job";
import { DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY } from "@/lib/video/deposit-slip-fingerprint-shadow-chunks.shared";

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "shadow-1",
    sessionId: "sess-1",
    allianceId: "ally-1",
    hqUserId: "user-1",
    scoreTarget: "bank-deposit-slip-history",
    category: "bank-deposit-slip-history",
    storageKey: "video.mp4",
    boardKey: null,
    hqEventId: null,
    groupId: "group-1",
    passKey: "row_fingerprint_v1",
    passRole: "deposit_slip_fingerprint_shadow",
    status: "queued",
    fileName: null,
    fileSizeBytes: null,
    frameCount: 3,
    uploadedFrameCount: 0,
    parseSessionId: null,
    errorMessage: null,
    timingsJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("processDepositSlipFingerprintShadowJob chunking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE", "2");
    mockDispatch.mockResolvedValue(true);
    mockCompare.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
    mockUpdateReturning.mockResolvedValue([{ id: "shadow-1" }]);
    mockUpdateWhere.mockResolvedValue(undefined);
    mockInsertValues.mockResolvedValue(undefined);
    mockGetObject.mockImplementation(async (key: string) => Buffer.from(key));
    mockPreprocess.mockResolvedValue({
      buffer: Buffer.from("processed"),
      height: 100,
    });
    mockTesseract.mockResolvedValue([
      {
        text: "Alice 100",
        confidence: 90,
        bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
        rowHeight: 10,
      },
    ]);
  });

  it("OCRs one chunk and dispatches continuation when frames remain", async () => {
    // 1) initial job load
    // 2) group load
    // 3) primary job load
    mockSelectLimit
      .mockResolvedValueOnce([baseJob()])
      .mockResolvedValueOnce([{ primaryJobId: "primary-1" }])
      .mockResolvedValueOnce([{ allianceId: "ally-1" }]);

    mockSelectOrderBy.mockResolvedValue([
      { frameIndex: 0, storageKey: "f0" },
      { frameIndex: 1, storageKey: "f1" },
      { frameIndex: 2, storageKey: "f2" },
    ]);

    const timings = await processDepositSlipFingerprintShadowJob("shadow-1");

    expect(mockGetObject).toHaveBeenCalledTimes(2);
    expect(mockTesseract).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalledWith("shadow-1", {
      source: "deposit_slip_fingerprint_shadow_chunk",
      awaitResult: true,
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(timings.rowCount).toBe(0);

    const continueUpdate = mockUpdateWhere.mock.calls.find(
      ([payload]) =>
        payload &&
        typeof payload === "object" &&
        (payload as { timingsJson?: unknown }).timingsJson != null &&
        (payload as { status?: string }).status === "parsing",
    );
    expect(continueUpdate).toBeTruthy();
    const payload = continueUpdate![0] as {
      timingsJson: Record<string, unknown>;
      uploadedFrameCount: number;
    };
    expect(payload.uploadedFrameCount).toBe(2);
    const chunk = payload.timingsJson[
      DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY
    ] as {
      nextFrameOffset: number;
      frameLines: unknown[];
    };
    expect(chunk.nextFrameOffset).toBe(2);
    expect(chunk.frameLines).toHaveLength(2);
  });

  it("finalizes on the last chunk using prior persisted lines", async () => {
    const priorTimings = {
      [DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY]: {
        version: 1,
        nextFrameOffset: 2,
        totalFrames: 3,
        chunkSize: 2,
        frameLines: [
          {
            frameIndex: 0,
            frameHeight: 100,
            lines: [{ text: "Alice 100", confidence: 90, bbox: null, rowHeight: null }],
          },
          {
            frameIndex: 1,
            frameHeight: 100,
            lines: [{ text: "Bob 50", confidence: 88, bbox: null, rowHeight: null }],
          },
        ],
        ocrFrameMs: [10, 11],
      },
    };

    mockSelectLimit
      .mockResolvedValueOnce([
        baseJob({ status: "parsing", timingsJson: priorTimings }),
      ])
      .mockResolvedValueOnce([{ primaryJobId: "primary-1" }])
      .mockResolvedValueOnce([{ allianceId: "ally-1" }]);

    mockSelectOrderBy.mockResolvedValue([
      { frameIndex: 0, storageKey: "f0" },
      { frameIndex: 1, storageKey: "f1" },
      { frameIndex: 2, storageKey: "f2" },
    ]);

    const timings = await processDepositSlipFingerprintShadowJob("shadow-1");

    expect(mockUpdateReturning).not.toHaveBeenCalled();
    expect(mockGetObject).toHaveBeenCalledTimes(1);
    expect(mockTesseract).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalled();
    expect(mockCompare).toHaveBeenCalledWith({ groupId: "group-1" });
    expect(timings.frameCount).toBe(3);
    expect(
      (timings as Record<string, unknown>)[
        DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY
      ],
    ).toBeUndefined();

    const completeUpdate = mockUpdateWhere.mock.calls.find(
      ([payload]) =>
        payload &&
        typeof payload === "object" &&
        (payload as { status?: string }).status === "complete",
    );
    expect(completeUpdate).toBeTruthy();
  });

  it("requeues when next-chunk dispatch fails", async () => {
    mockDispatch.mockResolvedValue(false);
    mockSelectLimit
      .mockResolvedValueOnce([baseJob()])
      .mockResolvedValueOnce([{ primaryJobId: "primary-1" }])
      .mockResolvedValueOnce([{ allianceId: "ally-1" }]);
    mockSelectOrderBy.mockResolvedValue([
      { frameIndex: 0, storageKey: "f0" },
      { frameIndex: 1, storageKey: "f1" },
      { frameIndex: 2, storageKey: "f2" },
    ]);

    await processDepositSlipFingerprintShadowJob("shadow-1");

    const queuedUpdate = mockUpdateWhere.mock.calls.find(
      ([payload]) =>
        payload &&
        typeof payload === "object" &&
        (payload as { status?: string }).status === "queued",
    );
    expect(queuedUpdate).toBeTruthy();
    const payload = queuedUpdate![0] as {
      timingsJson: Record<string, unknown>;
    };
    expect(
      payload.timingsJson[DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY],
    ).toBeTruthy();
    expect((queuedUpdate![0] as { uploadedFrameCount?: number }).uploadedFrameCount).toBe(2);
    expect((queuedUpdate![0] as { frameCount?: number }).frameCount).toBe(3);
  });

  it("finalizes from persisted lines when OCR cursor is past the last frame", async () => {
    const priorTimings = {
      [DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY]: {
        version: 1,
        nextFrameOffset: 3,
        totalFrames: 3,
        chunkSize: 2,
        frameLines: [
          {
            frameIndex: 0,
            frameHeight: 100,
            lines: [{ text: "Alice 100", confidence: 90, bbox: null, rowHeight: null }],
          },
          {
            frameIndex: 1,
            frameHeight: 100,
            lines: [{ text: "Bob 50", confidence: 88, bbox: null, rowHeight: null }],
          },
          {
            frameIndex: 2,
            frameHeight: 100,
            lines: [{ text: "Carol 25", confidence: 87, bbox: null, rowHeight: null }],
          },
        ],
        ocrFrameMs: [10, 11, 12],
      },
    };

    mockSelectLimit
      .mockResolvedValueOnce([
        baseJob({ status: "parsing", timingsJson: priorTimings }),
      ])
      .mockResolvedValueOnce([{ primaryJobId: "primary-1" }])
      .mockResolvedValueOnce([{ allianceId: "ally-1" }]);

    mockSelectOrderBy.mockResolvedValue([
      { frameIndex: 0, storageKey: "f0" },
      { frameIndex: 1, storageKey: "f1" },
      { frameIndex: 2, storageKey: "f2" },
    ]);

    const timings = await processDepositSlipFingerprintShadowJob("shadow-1");

    expect(mockUpdateReturning).not.toHaveBeenCalled();
    expect(mockGetObject).not.toHaveBeenCalled();
    expect(mockTesseract).not.toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalled();
    expect(timings.frameCount).toBe(3);
  });
});
