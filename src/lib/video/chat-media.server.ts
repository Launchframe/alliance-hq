import "server-only";

import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

import sharp from "sharp";

import { deleteObject, putObject } from "@/lib/storage";
import type { ChatExtractedFrame } from "@/lib/video/chat-frames.server";
import { fingerprintDistance } from "@/lib/video/chat-frames.server";
import type { StitchedChatMedia } from "@/lib/video/chat-parser.shared";
import { CHAT_MEDIA_MAX_OBSERVATIONS } from "@/lib/video/chat-video.shared";

export { CHAT_MEDIA_MAX_OBSERVATIONS };

export const CHAT_MEDIA_MIN_CROP = 32;
export const CHAT_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_MEDIA_THUMB_MAX = 480;
export const CHAT_MEDIA_TOTAL_BYTES = 60 * 1024 * 1024;
const MEDIA_FINGERPRINT_SIZE = 16;
const MEDIA_FINGERPRINT_MAX_MEAN_DIFF = 2.0;

export type ChatMediaArtifact = {
  media: StitchedChatMedia;
  mediaId: string;
  storageKey: string;
  thumbnailStorageKey: string;
  contentType: string;
  sha256: string;
  width: number;
  height: number;
  sharpness: number;
  fingerprint: Uint8Array;
  png: Buffer;
  thumb: Buffer;
};

export function chatMediaStorageKeys(importId: string, mediaId: string) {
  return {
    storageKey: `notes-history/${importId}/media/${mediaId}.png`,
    thumbnailStorageKey: `notes-history/${importId}/media/${mediaId}.webp`,
  };
}

export function clampCropBox(
  box: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } | null {
  const left = Math.min(Math.max(Math.floor(box.x * imageWidth), 0), Math.max(imageWidth - 1, 0));
  const top = Math.min(Math.max(Math.floor(box.y * imageHeight), 0), Math.max(imageHeight - 1, 0));
  const right = Math.min(Math.max(Math.ceil((box.x + box.width) * imageWidth), left + 1), imageWidth);
  const bottom = Math.min(Math.max(Math.ceil((box.y + box.height) * imageHeight), top + 1), imageHeight);
  const width = right - left;
  const height = bottom - top;
  if (width < CHAT_MEDIA_MIN_CROP || height < CHAT_MEDIA_MIN_CROP) return null;
  return { left, top, width, height };
}

export function dedupeMediaArtifacts(artifacts: ChatMediaArtifact[]): ChatMediaArtifact[] {
  const kept: ChatMediaArtifact[] = [];
  for (const artifact of artifacts) {
    const duplicateIndex = kept.findIndex(
      (existing) =>
        existing.media.kind === artifact.media.kind &&
        fingerprintDistance(existing.fingerprint, artifact.fingerprint) < MEDIA_FINGERPRINT_MAX_MEAN_DIFF,
    );
    if (duplicateIndex < 0) {
      kept.push(artifact);
      continue;
    }
    const existing = kept[duplicateIndex]!;
    const existingPixels = existing.width * existing.height;
    const incomingPixels = artifact.width * artifact.height;
    if (incomingPixels > existingPixels || (incomingPixels === existingPixels && artifact.sharpness > existing.sharpness)) {
      kept[duplicateIndex] = artifact;
    }
  }
  return kept;
}

export async function buildChatMediaArtifact(
  media: StitchedChatMedia,
  frame: ChatExtractedFrame,
  importId: string,
): Promise<ChatMediaArtifact | null> {
  const crop = clampCropBox(media.box, frame.width, frame.height);
  if (!crop) return null;
  const png = await sharp(frame.png)
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .png()
    .toBuffer();
  if (png.byteLength > CHAT_MEDIA_MAX_BYTES) return null;
  const thumb = await sharp(png)
    .resize(CHAT_MEDIA_THUMB_MAX, CHAT_MEDIA_THUMB_MAX, { fit: "inside", withoutEnlargement: true })
    .webp()
    .toBuffer();
  const [stats, fingerprint] = await Promise.all([
    sharp(png).grayscale().stats(),
    sharp(png).resize(MEDIA_FINGERPRINT_SIZE, MEDIA_FINGERPRINT_SIZE, { fit: "fill" }).grayscale().raw().toBuffer(),
  ]);
  const mediaId = nanoid();
  const keys = chatMediaStorageKeys(importId, mediaId);
  return {
    media,
    mediaId,
    ...keys,
    contentType: "image/png",
    sha256: createHash("sha256").update(png).digest("hex"),
    width: crop.width,
    height: crop.height,
    sharpness: Math.min(1, (stats.channels[0]?.stdev ?? 0) / 64),
    fingerprint: new Uint8Array(fingerprint),
    png,
    thumb,
  };
}

export async function buildChatMediaArtifacts(
  items: readonly StitchedChatMedia[],
  frames: readonly ChatExtractedFrame[],
  importId: string,
  totalByteCap = CHAT_MEDIA_TOTAL_BYTES,
): Promise<ChatMediaArtifact[]> {
  const artifacts: ChatMediaArtifact[] = [];
  let totalBytes = 0;
  for (const item of items) {
    const frame = frames[item.sourceFrameIndex];
    if (!frame) continue;
    const artifact = await buildChatMediaArtifact(item, frame, importId);
    if (!artifact) continue;
    const bytes = artifact.png.byteLength + artifact.thumb.byteLength;
    if (totalBytes + bytes > totalByteCap) throw new Error("chat_import_limit");
    totalBytes += bytes;
    artifacts.push(artifact);
  }
  return artifacts;
}

export async function uploadChatMediaArtifacts(artifacts: ChatMediaArtifact[]): Promise<string[]> {
  const createdKeys: string[] = [];
  try {
    for (const artifact of artifacts) {
      await putObject(artifact.storageKey, artifact.png);
      createdKeys.push(artifact.storageKey);
      await putObject(artifact.thumbnailStorageKey, artifact.thumb);
      createdKeys.push(artifact.thumbnailStorageKey);
    }
  } catch (error) {
    await Promise.all(createdKeys.map((key) => deleteObject(key).catch(() => undefined)));
    throw error;
  }
  return createdKeys;
}
