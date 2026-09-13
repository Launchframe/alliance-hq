import "server-only";

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { deleteObject, prefersLocalStorage, putLocalObjectStreamBounded } from "@/lib/storage";
import { presignR2PutObjectBounded } from "@/lib/storage/r2";
import { OcrLearningError, ocrHashSchema } from "../benchmark/types.shared";
import { leasedWorkerJob } from "./control-leases.server";
import { workerHash, workerUsage } from "./control-policy.server";
import { hashStoredObject, sealStoredObject } from "./media-storage.server";
import { workerModelManifestSchema } from "./worker.shared";

const artifactRequest = z.object({ sha256: ocrHashSchema, bytes: z.number().int().positive().max(2 * 1024 ** 3), manifestText: z.string().min(1).max(1024 * 1024) }).strict();

function parseManifest(text: string) {
  try {
    const parsed = workerModelManifestSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch { }
  throw new OcrLearningError("invalid_model_manifest");
}

export async function loadWorkerArtifact(id: string) {
  const [artifact] = await getDb().select().from(schema.ocrWorkerArtifacts).where(eq(schema.ocrWorkerArtifacts.id, id)).limit(1);
  if (!artifact) throw new OcrLearningError("worker_artifact_not_found", 404);
  return artifact;
}

export async function reserveWorkerArtifact(jobId: string, leaseToken: string, input: z.infer<typeof artifactRequest>) {
  const parsed = artifactRequest.safeParse(input);
  if (!parsed.success) throw new OcrLearningError("invalid_worker_artifact");
  const manifest = parseManifest(parsed.data.manifestText);
  const manifestHash = createHash("sha256").update(parsed.data.manifestText).digest("hex");
  const artifact = await getDb().transaction(async (tx) => {
    const { job, policy, dataset } = await leasedWorkerJob(tx, jobId, leaseToken);
    if (job.kind !== "train" || !("recipe" in job.input.request) || manifest.datasetHash !== job.input.datasetHash || manifest.workerCodeHash !== job.input.pipelineDefinition.workerCodeHash || workerHash(manifest.recipe) !== workerHash(job.input.request.recipe)) throw new OcrLearningError("artifact_scope_mismatch", 409);
    if (parsed.data.bytes > job.input.request.limits.maxOutputBytes) throw new OcrLearningError("model_artifact_limit", 409);
    const [existing] = await tx.select().from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.jobId, jobId), eq(schema.ocrWorkerArtifacts.attempt, job.attempts))).limit(1);
    if (existing) {
      if (existing.sha256 !== parsed.data.sha256 || existing.bytes !== parsed.data.bytes || existing.manifestHash !== manifestHash) throw new OcrLearningError("artifact_request_conflict", 409);
      return existing;
    }
    if ((await workerUsage(tx, job.allianceId)).reservedBytes + parsed.data.bytes * 2 > policy.modelStorageBytes) throw new OcrLearningError("model_storage_budget", 409);
    const id = nanoid();
    const expiresAt = new Date(Math.min(Date.now() + policy.retentionDays * 86400000, ...dataset.entries.map(({ sample }) => new Date(sample.expiresAt).getTime())));
    const [created] = await tx.insert(schema.ocrWorkerArtifacts).values({ id, jobId, allianceId: job.allianceId, attempt: job.attempts, bytes: parsed.data.bytes, sha256: parsed.data.sha256, manifestText: parsed.data.manifestText, manifestHash,
      stagingKey: `ocr-staging/${job.allianceId}/models/${jobId}/${id}.bin`, sealedKey: `ocr-learning/${job.allianceId}/models/${jobId}/${id}.bin`, expiresAt }).returning();
    return created;
  });
  if (artifact.state === "sealed") return { id: artifact.id, state: artifact.state, upload: null };
  const seconds = Math.min(900, Math.floor((artifact.createdAt.getTime() + 15 * 60000 - Date.now()) / 1000));
  if (seconds <= 0) throw new OcrLearningError("artifact_upload_expired", 409);
  const url = prefersLocalStorage() ? `/api/internal/ocr-worker/artifacts/${artifact.id}` : await presignR2PutObjectBounded(artifact.stagingKey, "application/octet-stream", artifact.bytes, seconds);
  return { id: artifact.id, state: artifact.state, upload: { url, bytes: artifact.bytes, contentType: "application/octet-stream", method: "PUT" } };
}

export async function receiveWorkerArtifact(id: string, leaseToken: string, request: Request) {
  const artifact = await loadWorkerArtifact(id);
  await getDb().transaction(async (tx) => {
    const { job } = await leasedWorkerJob(tx, artifact.jobId, leaseToken);
    if (artifact.attempt !== job.attempts || artifact.state !== "reserved" || artifact.expiresAt <= new Date() || artifact.createdAt.getTime() + 15 * 60000 <= Date.now()) throw new OcrLearningError("artifact_upload_expired", 409);
  });
  if (!prefersLocalStorage() || !request.body || request.headers.get("content-type")?.split(";")[0] !== "application/octet-stream") throw new OcrLearningError("invalid_worker_artifact");
  if (request.headers.has("content-length") && Number(request.headers.get("content-length")) !== artifact.bytes) throw new OcrLearningError("artifact_size_mismatch", 409);
  let created = true, digest;
  try { digest = await putLocalObjectStreamBounded(artifact.stagingKey, request.body, artifact.bytes); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    created = false;
    digest = await hashStoredObject(artifact.stagingKey, artifact.bytes);
  }
  if (digest.bytes !== artifact.bytes || digest.sha256 !== artifact.sha256) {
    if (created) await deleteObject(artifact.stagingKey, AbortSignal.timeout(30000));
    throw new OcrLearningError("artifact_digest_mismatch", 409);
  }
  return { id, received: digest.bytes };
}

function missing(error: unknown) {
  return Boolean(error && typeof error === "object" && (("code" in error && error.code === "ENOENT") || ("name" in error && ["NotFound", "NoSuchKey"].includes(String(error.name)))));
}

export async function sealWorkerArtifact(id: string, jobId: string, leaseToken: string) {
  const peek = await loadWorkerArtifact(id);
  await getDb().transaction(async (tx) => {
    const { job } = await leasedWorkerJob(tx, jobId, leaseToken);
    if (peek.jobId !== job.id || peek.attempt !== job.attempts || peek.allianceId !== job.allianceId) throw new OcrLearningError("stale_worker_lease", 409);
  });
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ocr-artifact:${id}`}, 0))`);
    const [artifact] = await tx.select().from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.id, id), eq(schema.ocrWorkerArtifacts.jobId, jobId))).limit(1);
    if (!artifact || artifact.state === "deleted" || artifact.expiresAt <= new Date()) throw new OcrLearningError("worker_artifact_not_found", 404);
    if (artifact.state !== "sealed") {
      let digest;
      try { digest = await hashStoredObject(artifact.sealedKey, artifact.bytes); }
      catch (error) { if (!missing(error)) throw error; }
      if (!digest) digest = await sealStoredObject({ allianceId: artifact.allianceId, caseId: "models", sourceKey: artifact.stagingKey, destinationKey: artifact.sealedKey, extension: ".bin", maxBytes: artifact.bytes, expectedSha256: artifact.sha256 });
      if (digest.sha256 !== artifact.sha256 || digest.bytes !== artifact.bytes) throw new OcrLearningError("artifact_digest_mismatch", 409);
    }
    const { job } = await leasedWorkerJob(tx, jobId, leaseToken);
    if (job.attempts !== artifact.attempt || job.allianceId !== artifact.allianceId) throw new OcrLearningError("stale_worker_lease", 409);
    if (artifact.state !== "sealed") await tx.update(schema.ocrWorkerArtifacts).set({ state: "sealed" }).where(eq(schema.ocrWorkerArtifacts.id, id));
    return { ...artifact, state: "sealed" as const };
  });
}
