import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadFrames = vi.fn();
const mockGetObject = vi.fn();
const mockOcrChunk = vi.fn();
const mockFinalize = vi.fn();
const mockDispatch = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/storage", () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args),
}));

vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing: (...args: unknown[]) => mockDispatch(...args),
}));

vi.mock("@/lib/video/process-deposit-slip-job", () => ({
  ocrDepositSlipVideoFrameChunk: (...args: unknown[]) => mockOcrChunk(...args),
  finalizeDepositSlipVideoParse: (...args: unknown[]) => mockFinalize(...args),
}));

vi.mock("@/lib/video/ocr-mock", () => ({
  mockOcrDepositSlipFrames: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => mockLoadFrames(),
        }),
      }),
    }),
    update: () => ({
      set: (payload: unknown) => ({
        where: (condition: unknown) => mockUpdateWhere(payload, condition),
      }),
    }),
  }),
  schema: {
    videoFrames: {
      frameIndex: "videoFrames.frameIndex",
      storageKey: "videoFrames.storageKey",
      ocrRawJson: "videoFrames.ocrRawJson",
      videoTimestampSeconds: "videoFrames.videoTimestampSeconds",
      jobId: "videoFrames.jobId",
    },
    videoJobs: { id: "videoJobs.id", timingsJson: "videoJobs.timingsJson" },
  },
}));

import { runDepositSlipOcrPhase } from "@/lib/video/run-deposit-slip-ocr-phase.server";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";

const timer = {
  measureStep: async <T,>(_name: string, fn: () => T | Promise<T>): Promise<T> =>
    fn(),
} as PipelineTimer;

describe("runDepositSlipOcrPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE", "2");
    mockDispatch.mockResolvedValue(undefined);
    mockUpdateWhere.mockResolvedValue(undefined);
    mockGetObject.mockImplementation(async (key: string) =>
      Buffer.from(key),
    );
    mockOcrChunk.mockResolvedValue({
      hqAllianceId: "alliance-1",
      ocrFrameMs: [1, 1],
      ocrConcurrency: 1,
      totalRawOcrRows: 2,
      framesOcrComplete: 2,
      frameHistories: [],
    });
    mockFinalize.mockResolvedValue({
      parseSessionId: "parse-1",
      hqAllianceId: "alliance-1",
      rowCount: 3,
      matchedCount: 2,
    });
  });

  it("OCRs a chunk and continues when more frames remain", async () => {
    mockLoadFrames.mockResolvedValue([
      {
        frameIndex: 0,
        storageKey: "f0",
        ocrRawJson: null,
        videoTimestampSeconds: 0,
      },
      {
        frameIndex: 1,
        storageKey: "f1",
        ocrRawJson: null,
        videoTimestampSeconds: 1,
      },
      {
        frameIndex: 2,
        storageKey: "f2",
        ocrRawJson: null,
        videoTimestampSeconds: 2,
      },
    ]);

    const setContinueChunk = vi.fn().mockResolvedValue(undefined);
    const setChunkProgress = vi.fn().mockResolvedValue(undefined);

    const result = await runDepositSlipOcrPhase({
      jobId: "job-1",
      sessionId: "session-1",
      scoreTargetId: "bank-deposit-slip-history",
      target: { id: "bank-deposit-slip-history" } as never,
      engine: "native",
      extractedFrames: [],
      timingsJson: null,
      timer,
      now: new Date("2026-07-18T00:00:00.000Z"),
      onOcrProgress: vi.fn(),
      setChunkProgress,
      setContinueChunk,
    });

    expect(result.kind).toBe("continue");
    if (result.kind !== "continue") return;
    expect(result.nextFrameOffset).toBe(2);
    expect(result.totalFrames).toBe(3);
    expect(mockOcrChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [
          { index: 0, buffer: expect.any(Buffer) },
          { index: 1, buffer: expect.any(Buffer) },
        ],
      }),
    );
    expect(setContinueChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        nextFrameOffset: 2,
        totalFrames: 3,
      }),
    );
    expect(mockDispatch).toHaveBeenCalledWith("job-1", {
      source: "deposit_slip_ocr_chunk",
    });
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it("finalizes when the last chunk completes", async () => {
    mockLoadFrames.mockResolvedValue([
      {
        frameIndex: 0,
        storageKey: "f0",
        ocrRawJson: { history: { slips: [] } },
        videoTimestampSeconds: 0,
      },
      {
        frameIndex: 1,
        storageKey: "f1",
        ocrRawJson: { history: { slips: [] } },
        videoTimestampSeconds: 1,
      },
      {
        frameIndex: 2,
        storageKey: "f2",
        ocrRawJson: null,
        videoTimestampSeconds: 2,
      },
    ]);

    mockOcrChunk.mockResolvedValue({
      hqAllianceId: "alliance-1",
      ocrFrameMs: [1],
      ocrConcurrency: 1,
      totalRawOcrRows: 1,
      framesOcrComplete: 1,
      frameHistories: [],
    });

    const result = await runDepositSlipOcrPhase({
      jobId: "job-1",
      sessionId: "session-1",
      scoreTargetId: "bank-deposit-slip-history",
      target: { id: "bank-deposit-slip-history" } as never,
      engine: "native",
      extractedFrames: [],
      timingsJson: {
        depositSlipOcrChunk: {
          version: 1,
          nextFrameOffset: 2,
          totalFrames: 3,
          chunkSize: 2,
        },
      },
      timer,
      now: new Date("2026-07-18T00:00:00.000Z"),
      onOcrProgress: vi.fn(),
      setChunkProgress: vi.fn(),
      setContinueChunk: vi.fn(),
    });

    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(result.parseSessionId).toBe("parse-1");
    expect(result.rowCount).toBe(3);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalled();
  });

  it("rewinds a stale cursor that skipped frames still missing history", async () => {
    mockLoadFrames.mockResolvedValue([
      {
        frameIndex: 0,
        storageKey: "f0",
        ocrRawJson: { history: { slips: [] } },
        videoTimestampSeconds: 0,
      },
      {
        frameIndex: 1,
        storageKey: "f1",
        ocrRawJson: null,
        videoTimestampSeconds: 1,
      },
      {
        frameIndex: 2,
        storageKey: "f2",
        ocrRawJson: null,
        videoTimestampSeconds: 2,
      },
    ]);

    const result = await runDepositSlipOcrPhase({
      jobId: "job-1",
      sessionId: "session-1",
      scoreTargetId: "bank-deposit-slip-history",
      target: { id: "bank-deposit-slip-history" } as never,
      engine: "native",
      extractedFrames: [],
      timingsJson: {
        depositSlipOcrChunk: {
          version: 1,
          nextFrameOffset: 2,
          totalFrames: 3,
          chunkSize: 2,
        },
      },
      timer,
      now: new Date("2026-07-18T00:00:00.000Z"),
      onOcrProgress: vi.fn(),
      setChunkProgress: vi.fn(),
      setContinueChunk: vi.fn(),
    });

    expect(result.kind).toBe("complete");
    expect(mockOcrChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [
          { index: 1, buffer: expect.any(Buffer) },
          { index: 2, buffer: expect.any(Buffer) },
        ],
      }),
    );
  });
});
