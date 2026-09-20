import "server-only";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getObjectSize, prefersLocalStorage, putLocalObjectStreamBounded, deleteObject } from "@/lib/storage";
import { presignR2PutObjectBounded } from "@/lib/storage/r2";
import { OcrLearningError } from "../benchmark/types.shared";
import { loadMediaPolicy, loadMediaTask } from "./media-queue.server";
import { hashStoredObject } from "./media-storage.server";
import type { OcrActor } from "./corpus.server";

async function uploadableTask(allianceId: string, taskId: string, actor: OcrActor) {
  const task = await loadMediaTask(allianceId, taskId);
  const current = await loadMediaPolicy(allianceId);
  if (task.createdByHqUserId !== actor.hqUserId) throw new OcrLearningError("forbidden", 403);
  if (task.state !== "uploading" || task.expiresAt <= new Date() || task.createdAt.getTime() + 15 * 60000 <= Date.now() || !task.stagingKey.startsWith(`ocr-staging/${allianceId}/${taskId}/`)) throw new OcrLearningError("media_not_uploading", 409);
  if (!current.policy.enabled || !current.policy.dataPermissionApproved || current.revision !== task.policyRevision) throw new OcrLearningError("media_policy_changed", 409);
  return task;
}

export async function mediaUploadTarget(allianceId: string, taskId: string, actor: OcrActor) {
  const task = await uploadableTask(allianceId, taskId, actor);
  const url = prefersLocalStorage()
    ? `/api/admin/ocr-learning/imports/${encodeURIComponent(taskId)}/upload?allianceId=${encodeURIComponent(allianceId)}`
    : await presignR2PutObjectBounded(task.stagingKey, task.contentType, task.expectedBytes);
  return { id: task.id, upload: { url, method: "PUT", contentType: task.contentType, bytes: task.expectedBytes }, expiresAt: task.expiresAt };
}

export async function receiveLocalMedia(allianceId: string, taskId: string, actor: OcrActor, request: Request) {
  const task = await uploadableTask(allianceId, taskId, actor);
  if (!prefersLocalStorage() || !request.body) throw new OcrLearningError("invalid_upload");
  if (request.headers.get("content-type")?.split(";")[0] !== task.contentType || request.headers.has("content-length") && Number(request.headers.get("content-length")) !== task.expectedBytes) throw new OcrLearningError("invalid_upload");
  let digest, created = true;
  try {
    digest = await putLocalObjectStreamBounded(task.stagingKey, request.body, task.expectedBytes);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    created = false;
    digest = await hashStoredObject(task.stagingKey, task.expectedBytes);
  }
  if (digest.bytes !== task.expectedBytes || digest.sha256 !== task.expectedSha256) {
    if (created) await deleteObject(task.stagingKey);
    throw new OcrLearningError("source_hash_mismatch", 409);
  }
  return { id: task.id, received: digest.bytes };
}

export async function verifyMediaUploadSize(allianceId: string, taskId: string) {
  const task = await loadMediaTask(allianceId, taskId);
  if (task.state === "ready" || task.state === "running" || task.state === "queued") return task;
  if (task.state !== "uploading" && task.state !== "failed") throw new OcrLearningError("media_not_uploading", 409);
  const [source] = await getDb().select().from(schema.ocrMediaObjects).where(eq(schema.ocrMediaObjects.storageKey, task.sourceKey)).limit(1);
  if (source?.state === "ready" && source.sha256 === task.expectedSha256) return task;
  if (await getObjectSize(task.stagingKey, AbortSignal.timeout(30000)) !== task.expectedBytes) throw new OcrLearningError("source_size_limit", 409);
  return task;
}
