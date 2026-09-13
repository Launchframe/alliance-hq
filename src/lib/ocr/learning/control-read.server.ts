import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getObjectSize, getObjectStream } from "@/lib/storage";
import { OcrLearningError, ocrHashSchema, ocrStorageKeySchema } from "../benchmark/types.shared";
import { leasedWorkerJob } from "./control-leases.server";
import { loadModelVersion } from "./control-jobs.server";

export async function workerFrameAsset(jobId: string, token: string, sha256: string) {
  if (!ocrHashSchema.safeParse(sha256).success) throw new OcrLearningError("invalid_worker_asset");
  return getDb().transaction(async (tx) => {
    const { job } = await leasedWorkerJob(tx, jobId, token);
    const asset = job.input.assets.find((item) => item.sha256 === sha256);
    if (!asset || !ocrStorageKeySchema.safeParse(asset.storageKey).success || !asset.storageKey.startsWith(`ocr-learning/${job.allianceId}/`)) throw new OcrLearningError("worker_asset_not_found", 404);
    return asset;
  });
}

export async function workerModelAsset(jobId: string, token: string) {
  return getDb().transaction(async (tx) => {
    const { job } = await leasedWorkerJob(tx, jobId, token);
    if (!job.pipelineId) return null;
    const model = await loadModelVersion(tx, job.allianceId, job.pipelineId);
    if (!model.artifactId) return null;
    const [artifact] = await tx.select().from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.id, model.artifactId), eq(schema.ocrWorkerArtifacts.allianceId, job.allianceId))).limit(1);
    if (!artifact || artifact.state !== "sealed" || artifact.expiresAt <= new Date() || !artifact.sealedKey.startsWith(`ocr-learning/${job.allianceId}/models/`)) throw new OcrLearningError("model_unavailable", 409);
    return { storageKey: artifact.sealedKey, sha256: artifact.sha256, bytes: artifact.bytes, manifestHash: artifact.manifestHash };
  });
}

export async function workerAssetResponse(asset: { storageKey: string; sha256: string; bytes: number }) {
  if (!ocrStorageKeySchema.safeParse(asset.storageKey).success || await getObjectSize(asset.storageKey, AbortSignal.timeout(30000)) !== asset.bytes) throw new OcrLearningError("worker_asset_changed", 409);
  return new Response(await getObjectStream(asset.storageKey, undefined, AbortSignal.timeout(120000)), { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(asset.bytes), "X-Content-Type-Options": "nosniff", ETag: `"${asset.sha256}"` } });
}
