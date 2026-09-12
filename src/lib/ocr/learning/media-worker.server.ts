import "server-only";

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getObject, putObject, streamObjectToFile } from "@/lib/storage";
import { parseFfmpegDurationSeconds, parseFfmpegShowinfoPtsTimes } from "@/lib/video/frame-extractor";
import { OcrLearningError, type OcrCase } from "../benchmark/types.shared";
import { claimMediaTask, completeMediaTask, failMediaTask, markMediaObjectReady, reserveMediaFrame } from "./media-queue.server";
import { mediaExtension } from "./media.shared";
import { hashStoredObject, sealStoredObject } from "./media-storage.server";
import { readPngFrames } from "./png-stream.server";
import { hashVideoInput } from "./media-hash.server";

const execute = promisify(execFile);
const maxPixels = 6_000_000;
const maxFrameBytes = 20 * 1024 ** 2;

async function probeVideo(file: string): Promise<number> {
  let stderr = "";
  try {
    stderr = (await execute(ffmpegStatic ?? "ffmpeg", ["-hide_banner", "-nostdin", "-i", file], { timeout: 15000, maxBuffer: 1024 * 1024 })).stderr;
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error) stderr = String(error.stderr);
    else throw new OcrLearningError("media_decoder_unavailable");
  }
  const duration = parseFfmpegDurationSeconds(stderr);
  const dimensions = stderr.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  if (!duration || duration > 3600 || !dimensions || Number(dimensions[1]) * Number(dimensions[2]) > maxPixels) throw new OcrLearningError("unsupported_media_dimensions");
  return duration;
}

async function decodeVideo(file: string, maxFrames: number, consume: (buffer: Buffer, index: number) => Promise<void>) {
  const duration = await probeVideo(file);
  const spacing = duration / Math.max(1, maxFrames - 1);
  const child = spawn(ffmpegStatic ?? "ffmpeg", [
    "-hide_banner", "-nostdin", "-threads", "2", "-max_alloc", "134217728", "-i", file, "-map", "0:v:0",
    "-vf", `select='gte(t,0)*(isnan(prev_selected_t)+gte(t-prev_selected_t,${spacing}))',showinfo`,
    "-vsync", "vfr", "-frames:v", String(maxFrames), "-threads", "2", "-compression_level", "3", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "", timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 120000);
  timer.unref();
  const done = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }));
    child.once("close", (code) => resolve({ code }));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length + chunk.length > 2 * 1024 ** 2) child.kill("SIGKILL");
    else stderr += chunk.toString("utf8");
  });
  let count = 0;
  try {
    for await (const buffer of readPngFrames(child.stdout, maxFrames, maxFrameBytes)) await consume(buffer, count++);
    const result = await done;
    if (result.error || result.code !== 0 || timedOut) throw new OcrLearningError(timedOut ? "media_decode_timeout" : "media_decode_failed");
    const timestamps = parseFfmpegShowinfoPtsTimes(stderr).slice(0, count);
    if (timestamps.length !== count || timestamps.some((time) => time < 0 || time > duration + 0.1)) throw new OcrLearningError("media_timestamps_missing");
    return { duration, timestamps };
  } finally { clearTimeout(timer); child.kill("SIGKILL"); await done; }
}

export async function processMediaTask(taskId: string): Promise<string> {
  const task = await claimMediaTask(taskId);
  if (!task) return taskId;
  const token = task.leaseToken!;
  const directory = path.join(os.tmpdir(), "ocr-learning-media", task.id, token);
  try {
    const [source] = await getDb().select().from(schema.ocrMediaObjects).where(eq(schema.ocrMediaObjects.storageKey, task.sourceKey)).limit(1);
    const sealed = source?.state === "ready"
      ? { storageKey: task.sourceKey, ...await hashStoredObject(task.sourceKey, task.expectedBytes) }
      : await sealStoredObject({ allianceId: task.allianceId, caseId: task.id, sourceKey: task.stagingKey, destinationKey: task.sourceKey, extension: mediaExtension(task.contentType), maxBytes: task.expectedBytes, expectedSha256: task.expectedSha256 });
    if (sealed.sha256 !== task.expectedSha256 || sealed.bytes !== task.expectedBytes) throw new OcrLearningError("source_hash_mismatch", 409);
    await markMediaObjectReady(task.id, token, sealed.storageKey, sealed.sha256, sealed.bytes);
    const file = path.join(directory, `source${mediaExtension(task.contentType)}`);
    const frames: Array<OcrCase["frames"][number] & { index: number }> = [];
    const seen = new Set<string>();
    const consume = async (buffer: Buffer, index: number) => {
      if (buffer.length > maxFrameBytes) throw new OcrLearningError("frame_size_limit");
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (seen.has(sha256)) return;
      const metadata = await sharp(buffer, { limitInputPixels: maxPixels }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) throw new OcrLearningError("unsupported_media_dimensions");
      const storageKey = await reserveMediaFrame(task.id, token, buffer.length, sha256);
      await putObject(storageKey, buffer, AbortSignal.timeout(30000));
      await markMediaObjectReady(task.id, token, storageKey, sha256, buffer.length);
      seen.add(sha256);
      frames.push({ index, sha256, storageKey, timestampSeconds: 0, width: metadata.width, height: metadata.height });
    };
    let durationSeconds: number | null = null;
    if (task.contentType.startsWith("image/")) {
      if (task.expectedBytes > maxFrameBytes) throw new OcrLearningError("frame_size_limit");
      const input = await getObject(sealed.storageKey);
      if (input.length !== task.expectedBytes || createHash("sha256").update(input).digest("hex") !== task.expectedSha256) throw new OcrLearningError("source_hash_mismatch", 409);
      const image = sharp(input, { limitInputPixels: maxPixels });
      const metadata = await image.metadata();
      if (metadata.format !== (task.contentType === "image/png" ? "png" : "jpeg")) throw new OcrLearningError("media_type_mismatch");
      await consume(await image.rotate().png().toBuffer(), 0);
    } else {
      await fs.mkdir(directory, { recursive: true });
      const downloaded = await streamObjectToFile(sealed.storageKey, file, task.expectedBytes);
      if (downloaded !== task.expectedBytes || await hashVideoInput(file, task.expectedBytes) !== task.expectedSha256) throw new OcrLearningError("source_hash_mismatch", 409);
      const decoded = await decodeVideo(file, task.policySnapshot.maxFrames, consume);
      durationSeconds = decoded.duration;
      for (const frame of frames) frame.timestampSeconds = decoded.timestamps[frame.index];
    }
    const sample: OcrCase = {
      id: task.id, allianceId: task.allianceId, scoreTarget: task.scoreTarget, recordingGroupId: task.id,
      sourceSha256: sealed.sha256, lineageHashes: [sealed.sha256], sourceKind: task.contentType.startsWith("image/") ? "extracted_frame" : "original_video",
      jobId: null, pairing: "unmatched", state: "candidate", labelRevision: 0, privacyReviewed: false, externalTrainingAllowed: false,
      expiresAt: task.expiresAt.toISOString(), durationSeconds, context: {},
      frames: frames.map((frame) => ({ sha256: frame.sha256, storageKey: frame.storageKey, timestampSeconds: frame.timestampSeconds, width: frame.width, height: frame.height })), labels: [],
    };
    await completeMediaTask(task.id, token, sample);
    return task.id;
  } catch (error) {
    await failMediaTask(task.id, token, error instanceof OcrLearningError ? error.code : "media_processing_failed");
    throw error;
  } finally { await fs.rm(path.join(os.tmpdir(), "ocr-learning-media", task.id, token), { recursive: true, force: true }); }
}
