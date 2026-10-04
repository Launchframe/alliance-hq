import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import { assertE2eDatabaseUrl } from "../../../../scripts/e2e-database-url-guard.mjs";
import { createNativeAlliance, createPlatformMaintainerSession, getE2eSql, closeE2eSql } from "../../../../e2e/fixtures/db";
import { getDb, getSqlClient, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { deleteObject, getObject, putObject } from "@/lib/storage";
import { createMediaUpload, enqueueMediaTask, saveMediaPolicy } from "./media-queue.server";
import { disabledMediaPolicy } from "./media.shared";
import { processMediaTask } from "./media-worker.server";
import { validateCaseEvidence } from "../benchmark/evidence.shared";

const taskIds: string[] = [];
async function setup(buffer: Buffer, contentType: "image/png" | "video/mp4") {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== process.env.E2E_DATABASE_URL?.trim() || process.env.R2_BUCKET) throw new Error("test_storage_mismatch");
  const user = await createPlatformMaintainerSession(getE2eSql());
  const { allianceId } = await createNativeAlliance(getE2eSql(), { tag: `MW${nanoid(4)}`, name: "Media worker fixture" });
  const actor = { hqUserId: user.hqUserId, sessionId: user.sessionId };
  await saveMediaPolicy(allianceId, 0, { ...disabledMediaPolicy, enabled: true, dataPermissionApproved: true, sourceLimitBytes: 1_000_000, storageBudgetBytes: 2_000_000, maxFrames: 4 }, actor);
  const task = await createMediaUpload({ allianceId, scoreTarget: "vs-performance", fileName: contentType === "image/png" ? "source.png" : "source.mp4", contentType, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), requestId: nanoid() }, actor);
  taskIds.push(task.id);
  await putObject(task.stagingKey, buffer);
  await enqueueMediaTask(allianceId, task.id, actor);
  return task;
}

describe.skipIf(process.env.OCR_LEARNING_DB_TEST !== "1")("real sealed media worker", () => {
  afterAll(async () => {
    if (taskIds.length) {
      const objects = await getDb().select({ key: schema.ocrMediaObjects.storageKey }).from(schema.ocrMediaObjects).where(inArray(schema.ocrMediaObjects.taskId, taskIds));
      await Promise.all(objects.map((object) => deleteObject(object.key)));
      await getSqlClient().end({ timeout: 5 });
    }
    await closeE2eSql();
  });

  it("decodes real image bytes and registers independent candidate evidence", async () => {
    const buffer = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#abcdef" } }).png().toBuffer();
    const task = await setup(buffer, "image/png");
    expect(await processMediaTask(task.id)).toBe(task.id);
    expect(await processMediaTask(task.id)).toBe(task.id);
    const [row] = await getDb().select().from(schema.ocrLearningCases).where(eq(schema.ocrLearningCases.id, task.id));
    expect(row.snapshot).toMatchObject({ state: "candidate", pairing: "unmatched", privacyReviewed: false, externalTrainingAllowed: false, labels: [], frames: [{ width: 64, height: 32, timestampSeconds: null }] });
    expect(() => validateCaseEvidence(row.snapshot)).not.toThrow();
    await deleteObject(task.stagingKey);
    expect(await getObject(row.sourceStorageKey)).toEqual(buffer);
    const pixels = await getObject(row.snapshot.frames[0].storageKey);
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(row.snapshot.frames[0].sha256);
  });

  it("uses bounded FFmpeg decoding and retains source presentation times", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ocr-video-fixture-"));
    try {
      const file = path.join(directory, "source.mp4");
      await promisify(execFile)(ffmpegStatic ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=4:duration=1", "-pix_fmt", "yuv420p", file], { timeout: 10000 });
      const task = await setup(await readFile(file), "video/mp4");
      await processMediaTask(task.id);
      const [row] = await getDb().select().from(schema.ocrLearningCases).where(eq(schema.ocrLearningCases.id, task.id));
      expect(row.snapshot.sourceKind).toBe("original_video");
      expect(row.snapshot.frames.length).toBeGreaterThan(0);
      expect(row.snapshot.frames.length).toBeLessThanOrEqual(4);
      expect(row.snapshot.frames.every((frame) => frame.timestampSeconds != null && frame.timestampSeconds >= 0 && frame.timestampSeconds <= 1)).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
