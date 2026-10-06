import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractLeaderboardFrames: vi.fn(),
  cleanupFrameTempDir: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/video/frame-extractor", () => mocks);

import sharp from "sharp";
import {
  collapseNearIdenticalFrames,
  extractChatVideoFrames,
  fingerprintDistance,
  sampleChatFramesEvenly,
  type ChatExtractedFrame,
} from "./chat-frames.server";

async function solidPng(color: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toBuffer();
}

async function extracted(index: number) {
  return {
    index,
    buffer: await solidPng({ r: index * 40, g: index * 40, b: index * 40 }),
    filePath: `/tmp/frame_${index}.png`,
    videoTimestampSeconds: index,
  };
}

function chatFrame(overrides: Partial<ChatExtractedFrame> = {}): ChatExtractedFrame {
  return {
    frameIndex: 0,
    png: Buffer.alloc(0),
    filePath: "/tmp/f.png",
    timestampMs: 0,
    frameHash: "h",
    width: 32,
    height: 32,
    sharpness: 0.5,
    fingerprint: new Uint8Array(256).fill(10),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extractLeaderboardFrames.mockResolvedValue({ frames: [], videoDurationSeconds: 90 });
  mocks.cleanupFrameTempDir.mockResolvedValue(undefined);
});

describe("fingerprintDistance", () => {
  it("is zero for identical fingerprints and grows with mean difference", () => {
    const a = new Uint8Array([10, 20, 30]);
    expect(fingerprintDistance(a, a)).toBe(0);
    expect(fingerprintDistance(a, new Uint8Array([20, 30, 40]))).toBeCloseTo(10);
    expect(fingerprintDistance(a, new Uint8Array(2))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("collapseNearIdenticalFrames", () => {
  it("collapses only consecutive near-identical frames, keeping the sharper one", () => {
    const near = new Uint8Array(256).fill(10);
    const nearSharper = new Uint8Array(256).fill(11);
    const different = new Uint8Array(256).fill(200);
    const frames = [
      chatFrame({ frameIndex: 0, sharpness: 0.4, fingerprint: near }),
      chatFrame({ frameIndex: 1, sharpness: 0.8, fingerprint: nearSharper }),
      chatFrame({ frameIndex: 2, sharpness: 0.3, fingerprint: different }),
      chatFrame({ frameIndex: 3, sharpness: 0.9, fingerprint: near }),
    ];
    const kept = collapseNearIdenticalFrames(frames);
    expect(kept.map((f) => f.frameIndex)).toEqual([1, 2, 3]);
    expect(kept[0]!.sharpness).toBe(0.8);
  });

  it("does not collapse non-consecutive similar frames", () => {
    const near = new Uint8Array(256).fill(10);
    const different = new Uint8Array(256).fill(200);
    const frames = [
      chatFrame({ frameIndex: 0, fingerprint: near }),
      chatFrame({ frameIndex: 1, fingerprint: different }),
      chatFrame({ frameIndex: 2, fingerprint: near }),
    ];
    expect(collapseNearIdenticalFrames(frames)).toHaveLength(3);
  });
});

describe("sampleChatFramesEvenly", () => {
  it("returns all frames when under the limit", () => {
    const frames = [1, 2, 3];
    expect(sampleChatFramesEvenly(frames, 5)).toEqual([1, 2, 3]);
  });

  it("samples monotonically across the whole timeline including first and last", () => {
    const frames = Array.from({ length: 241 }, (_, i) => i);
    const sampled = sampleChatFramesEvenly(frames, 120);
    expect(sampled).toHaveLength(120);
    expect(sampled[0]).toBe(0);
    expect(sampled[119]).toBe(240);
    expect(new Set(sampled).size).toBe(120);
    for (let i = 1; i < sampled.length; i++) {
      expect(sampled[i]!).toBeGreaterThan(sampled[i - 1]!);
    }
    for (const quartile of [60, 120, 180]) {
      const window = sampled.filter((v) => Math.abs(v - quartile) <= 2);
      expect(window.length).toBeGreaterThan(0);
    }
  });
});

describe("extractChatVideoFrames", () => {
  it("requests PNG frames with chat scene/fps config and cleans the temp dir", async () => {
    mocks.extractLeaderboardFrames.mockResolvedValue({
      frames: [await extracted(0), await extracted(1)],
      videoDurationSeconds: 90,
    });
    const result = await extractChatVideoFrames("/tmp/video.mp4");
    expect(mocks.extractLeaderboardFrames).toHaveBeenCalledWith(
      "/tmp/video.mp4",
      expect.objectContaining({ mode: "scene", sceneThreshold: 0.12, sampleFps: 1, supplementFps: 1 }),
      { imageFormat: "png", maxOutputFps: 2 },
    );
    expect(mocks.cleanupFrameTempDir).toHaveBeenCalled();
    expect(result.frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    expect(result.videoDurationSeconds).toBe(90);
  });

  it("computes a hash, dimensions, sharpness, and fingerprint per frame", async () => {
    const png = await solidPng({ r: 200, g: 200, b: 200 });
    mocks.extractLeaderboardFrames.mockResolvedValue({
      frames: [{ index: 0, buffer: png, filePath: "/tmp/f.png", videoTimestampSeconds: 1.5 }],
      videoDurationSeconds: 90,
    });
    const { frames } = await extractChatVideoFrames("/tmp/video.mp4");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.frameHash).toMatch(/^[0-9a-f]{64}$/);
    expect(frames[0]!.width).toBe(32);
    expect(frames[0]!.height).toBe(32);
    expect(frames[0]!.timestampMs).toBe(1500);
    expect(frames[0]!.fingerprint).toHaveLength(256);
    expect(frames[0]!.sharpness).toBeGreaterThanOrEqual(0);
    expect(frames[0]!.sharpness).toBeLessThanOrEqual(1);
  });

  it("caps provider frames at 120 while retaining the closing frame", async () => {
    const buffers = await Promise.all(
      Array.from({ length: 130 }, (_, i) => {
        const v = (i * 211) % 256;
        return solidPng({ r: v, g: v, b: v });
      }),
    );
    mocks.extractLeaderboardFrames.mockResolvedValue({
      frames: buffers.map((buffer, index) => ({ index, buffer, filePath: `/tmp/f${index}.png`, videoTimestampSeconds: index })),
      videoDurationSeconds: 130,
    });
    const { frames } = await extractChatVideoFrames("/tmp/video.mp4");
    expect(frames).toHaveLength(120);
    expect(frames[119]!.timestampMs).toBe(129_000);
    expect(frames.map((f) => f.frameIndex)).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });
});
