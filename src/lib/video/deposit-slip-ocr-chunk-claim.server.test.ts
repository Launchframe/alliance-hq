import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateReturning = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("nanoid", () => ({ nanoid: () => "claim-token-1" }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (payload: unknown) => ({
        where: () => ({
          returning: () => mockUpdateReturning(payload),
        }),
      }),
    }),
  }),
  schema: {
    videoJobs: {
      id: "videoJobs.id",
      timingsJson: "videoJobs.timingsJson",
    },
  },
}));

import {
  claimDepositSlipFingerprintShadowChunk,
  claimDepositSlipOcrChunk,
  createDepositSlipOcrChunkClaimToken,
  releaseDepositSlipOcrChunkClaim,
} from "@/lib/video/deposit-slip-ocr-chunk-claim.server";

describe("deposit-slip OCR chunk claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateReturning.mockResolvedValue([{ id: "job-1" }]);
  });

  it("creates short claim tokens", () => {
    expect(createDepositSlipOcrChunkClaimToken()).toBe("claim-token-1");
  });

  it("claims primary chunk state with a token", async () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    const result = await claimDepositSlipOcrChunk({
      jobId: "job-1",
      expectedOffset: 25,
      totalFrames: 181,
      chunkSize: 25,
      priorTimingsJson: { jobId: "job-1" },
      now,
    });

    expect(result.claimed).toBe(true);
    if (!result.claimed) return;
    expect(result.claimToken).toBe("claim-token-1");
    expect(result.timingsJson.depositSlipOcrChunk).toEqual({
      version: 1,
      nextFrameOffset: 25,
      totalFrames: 181,
      chunkSize: 25,
      claimToken: "claim-token-1",
    });
  });

  it("returns lost claim when compare-and-swap fails", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    const result = await claimDepositSlipOcrChunk({
      jobId: "job-1",
      expectedOffset: 0,
      totalFrames: 10,
      chunkSize: 5,
      priorTimingsJson: null,
      now: new Date(),
    });
    expect(result).toEqual({ claimed: false });
  });

  it("preserves prior shadow frame lines when claiming", async () => {
    const priorLine = {
      frameIndex: 0,
      frameHeight: 100,
      lines: [{ text: "Alice", confidence: 90, bbox: null, rowHeight: null }],
    };
    const result = await claimDepositSlipFingerprintShadowChunk({
      jobId: "shadow-1",
      expectedOffset: 2,
      totalFrames: 4,
      chunkSize: 2,
      priorChunk: {
        version: 1,
        nextFrameOffset: 2,
        totalFrames: 4,
        chunkSize: 2,
        frameLines: [priorLine],
        ocrFrameMs: [12],
      },
      priorTimingsJson: null,
      now: new Date(),
    });

    expect(result.claimed).toBe(true);
    if (!result.claimed) return;
    const chunk = result.timingsJson.depositSlipFingerprintShadowChunk as {
      frameLines: unknown[];
      claimToken: string;
    };
    expect(chunk.frameLines).toEqual([priorLine]);
    expect(chunk.claimToken).toBe("claim-token-1");
  });

  it("clears claim token when releasing after OCR", () => {
    expect(
      releaseDepositSlipOcrChunkClaim({
        version: 1,
        nextFrameOffset: 50,
        totalFrames: 181,
        chunkSize: 25,
        claimToken: "busy",
      }),
    ).toEqual({
      version: 1,
      nextFrameOffset: 50,
      totalFrames: 181,
      chunkSize: 25,
      claimToken: null,
    });
  });
});
