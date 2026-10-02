import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

import { cleanupFrameTempDir, extractLeaderboardFrames, type ExtractedFrame } from "@/lib/video/frame-extractor";

export const CHAT_FRAME_SCENE_THRESHOLD = 0.12;
export const CHAT_FRAME_FPS = 1;
export const CHAT_FRAME_MAX_PROVIDER_FRAMES = 120;
export const CHAT_FRAME_MAX_OUTPUT_FPS = 2;
const CHAT_FINGERPRINT_SIZE = 16;
const CHAT_FINGERPRINT_MAX_MEAN_DIFF = 2.0;

export type ChatExtractedFrame = {
  frameIndex: number;
  png: Buffer;
  filePath: string;
  timestampMs: number | null;
  frameHash: string;
  width: number;
  height: number;
  sharpness: number;
  fingerprint: Uint8Array;
};

export function fingerprintDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return sum / a.length;
}

async function analyzeFrame(frame: ExtractedFrame): Promise<ChatExtractedFrame> {
  const pipeline = sharp(frame.buffer);
  const [metadata, stats, fingerprint] = await Promise.all([
    pipeline.clone().metadata(),
    pipeline.clone().grayscale().stats(),
    pipeline.clone().resize(CHAT_FINGERPRINT_SIZE, CHAT_FINGERPRINT_SIZE, { fit: "fill" }).grayscale().raw().toBuffer(),
  ]);
  const channel = stats.channels[0];
  const sharpness = Math.min(1, (channel?.stdev ?? 0) / 64);
  return {
    frameIndex: frame.index,
    png: frame.buffer,
    filePath: frame.filePath,
    timestampMs: frame.videoTimestampSeconds != null ? Math.round(frame.videoTimestampSeconds * 1000) : null,
    frameHash: createHash("sha256").update(frame.buffer).digest("hex"),
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    sharpness,
    fingerprint: new Uint8Array(fingerprint),
  };
}

export function sampleChatFramesEvenly<T>(frames: readonly T[], limit: number): T[] {
  if (frames.length <= limit || limit <= 0) return [...frames];
  const last = frames.length - 1;
  const step = last / (limit - 1);
  return Array.from({ length: limit }, (_, i) => frames[Math.round(i * step)]!);
}

export function collapseNearIdenticalFrames(frames: ChatExtractedFrame[]): ChatExtractedFrame[] {
  const kept: ChatExtractedFrame[] = [];
  for (const frame of frames) {
    const last = kept[kept.length - 1];
    if (last && fingerprintDistance(last.fingerprint, frame.fingerprint) < CHAT_FINGERPRINT_MAX_MEAN_DIFF) {
      if (frame.sharpness > last.sharpness) kept[kept.length - 1] = frame;
      continue;
    }
    kept.push(frame);
  }
  return kept;
}

export async function extractChatVideoFrames(videoPath: string): Promise<{
  frames: ChatExtractedFrame[];
  videoDurationSeconds: number | null;
}> {
  const extracted = await extractLeaderboardFrames(
    videoPath,
    {
      mode: "scene",
      sceneThreshold: CHAT_FRAME_SCENE_THRESHOLD,
      sampleFps: CHAT_FRAME_FPS,
      supplementFps: CHAT_FRAME_FPS,
    },
    { imageFormat: "png", maxOutputFps: CHAT_FRAME_MAX_OUTPUT_FPS },
  );
  const analyzed: ChatExtractedFrame[] = [];
  try {
    for (const frame of extracted.frames) {
      const next = await analyzeFrame(frame);
      const last = analyzed[analyzed.length - 1];
      if (last && fingerprintDistance(last.fingerprint, next.fingerprint) < CHAT_FINGERPRINT_MAX_MEAN_DIFF) {
        if (next.sharpness > last.sharpness) analyzed[analyzed.length - 1] = next;
        continue;
      }
      analyzed.push(next);
    }
  } finally {
    await cleanupFrameTempDir(extracted.frames);
  }
  const capped = sampleChatFramesEvenly(analyzed, CHAT_FRAME_MAX_PROVIDER_FRAMES);
  return {
    frames: capped.map((frame, index) => ({ ...frame, frameIndex: index })),
    videoDurationSeconds: extracted.videoDurationSeconds,
  };
}
