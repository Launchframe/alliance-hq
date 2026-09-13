import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { getObjectSize } from "@/lib/storage";
import { datasetHash } from "../benchmark/dataset.server";
import { OcrLearningError, ocrIdSchema, ocrStorageKeySchema, type OcrDataset } from "../benchmark/types.shared";
import { loadUsableDataset, type OcrActor } from "./corpus.server";
import { pipelineDefinitionSchema, workerJobRequestSchema, type PipelineDefinition, type WorkerAsset, type WorkerJobInput, type WorkerJobRequest } from "./control.shared";
import { loadWorkerPolicy, lockWorker, pipelineId, workerAudit, workerHash } from "./control-policy.server";
import { buildWorkerInference, buildWorkerTraining } from "./worker-inputs.server";
import { workerRosterSchema } from "./worker.shared";
import type { OcrTransaction } from "./recording.server";

export async function loadWorkerJob(allianceId: string, id: string) {
  const [job] = await getDb().select().from(schema.ocrWorkerJobs).where(and(eq(schema.ocrWorkerJobs.id, id), eq(schema.ocrWorkerJobs.allianceId, allianceId))).limit(1);
  if (!job) throw new OcrLearningError("worker_job_not_found", 404);
  return job;
}

export async function loadModelVersion(tx: OcrTransaction, allianceId: string, id: string) {
  const [model] = await tx.select().from(schema.ocrModelVersions).where(and(eq(schema.ocrModelVersions.id, id), eq(schema.ocrModelVersions.allianceId, allianceId))).limit(1);
  if (!model || model.state === "revoked") throw new OcrLearningError("model_unavailable", 409);
  const definition = pipelineDefinitionSchema.safeParse(model.definition);
  if (!definition.success || pipelineId(allianceId, definition.data) !== model.id) throw new OcrLearningError("corrupt_model", 409);
  if (model.datasetId) await loadUsableDataset(allianceId, model.datasetId, {}, tx);
  if (model.artifactId) {
    const [artifact] = await tx.select().from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.id, model.artifactId), eq(schema.ocrWorkerArtifacts.allianceId, allianceId))).limit(1);
    if (!artifact || artifact.state !== "sealed" || artifact.expiresAt <= new Date() || artifact.manifestHash !== definition.data.artifactSha256) throw new OcrLearningError("model_unavailable", 409);
  } else if (definition.data.artifactSha256 !== null) throw new OcrLearningError("corrupt_model", 409);
  return model;
}

async function datasetAssets(dataset: OcrDataset, request: WorkerJobRequest, maxFrames: number) {
  const assets = new Map<string, WorkerAsset>();
  const entries = dataset.entries.filter(({ sample, split }) => sample.scoreTarget === request.scoreTarget && (request.kind === "train" ? split !== "test" : sample.id === request.caseId));
  for (const { sample } of entries) {
    const required = request.kind === "train" ? new Set(sample.labels.filter((label) => label.readable).flatMap((label) => label.evidence.filter((item) => item.nameBox && item.scoreBox).map((item) => item.frameSha256))) : null;
    for (const frame of sample.frames) {
      if (required && !required.has(frame.sha256)) continue;
      if (!ocrStorageKeySchema.safeParse(frame.storageKey).success || !frame.storageKey.startsWith(`ocr-learning/${dataset.allianceId}/`)) throw new OcrLearningError("invalid_worker_asset");
      assets.set(frame.sha256, { sha256: frame.sha256, bytes: 0, storageKey: frame.storageKey, caseId: sample.id });
    }
  }
  if (!assets.size || assets.size > maxFrames) throw new OcrLearningError("input_budget_exceeded");
  const values = [...assets.values()];
  for (let offset = 0; offset < values.length; offset += 8) {
    await Promise.all(values.slice(offset, offset + 8).map(async (asset) => {
      asset.bytes = await getObjectSize(asset.storageKey, AbortSignal.timeout(30000));
      if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 20 * 1024 ** 2) throw new OcrLearningError("invalid_worker_asset");
    }));
  }
  return values;
}

async function workerRoster(allianceId: string) {
  const rows = await getDb().select({ memberId: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName, aliases: schema.allianceMembers.previousNamesJson })
    .from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.status, "active"))).orderBy(asc(schema.allianceMembers.ashedMemberId)).limit(501);
  if (rows.length > 500) throw new OcrLearningError("worker_roster_limit", 409);
  const parsed = workerRosterSchema.safeParse(rows.map((row) => ({ ...row, aliases: row.aliases ?? [] })));
  if (!parsed.success) throw new OcrLearningError("invalid_worker_roster", 409);
  return parsed.data;
}

export async function createWorkerJob(input: WorkerJobRequest, actor: OcrActor) {
  const parsed = workerJobRequestSchema.safeParse(input);
  if (!parsed.success) throw new OcrLearningError("invalid_worker_job");
  const request = parsed.data;
  const requestHash = workerHash(request);
  const [existing] = await getDb().select().from(schema.ocrWorkerJobs).where(and(eq(schema.ocrWorkerJobs.allianceId, request.allianceId), eq(schema.ocrWorkerJobs.requestId, request.requestId))).limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash || existing.createdByHqUserId !== actor.hqUserId) throw new OcrLearningError("worker_request_conflict", 409);
    return { id: existing.id, state: existing.state, pipelineId: existing.pipelineId };
  }
  const configured = await loadWorkerPolicy(request.allianceId);
  if (!configured.policy.enabled || !configured.policy.trustedWorkerCodeHash) throw new OcrLearningError("worker_disabled", 409);
  const dataset = await loadUsableDataset(request.allianceId, request.datasetId);
  let definition: PipelineDefinition = { version: 1, scoreTarget: request.scoreTarget, workerCodeHash: configured.policy.trustedWorkerCodeHash, family: "paddle-v5-mobile-rec", sampler: request.sampler, artifactSha256: null };
  if (request.pipelineId) {
    const model = await getDb().transaction((tx) => loadModelVersion(tx, request.allianceId, request.pipelineId!));
    definition = model.definition;
    if (model.scoreTarget !== request.scoreTarget || definition.workerCodeHash !== configured.policy.trustedWorkerCodeHash) throw new OcrLearningError("model_scope_mismatch", 409);
  }
  const assets = await datasetAssets(dataset, request, configured.policy.limits.maxFrames);
  const sizes = new Map(assets.map((asset) => [asset.sha256, asset.bytes]));
  const roster = request.kind === "evaluate" && configured.policy.rosterScope === "current-alliance" ? await workerRoster(request.allianceId) : [];
  const modelId = pipelineId(request.allianceId, definition);
  const payload: WorkerJobInput = { datasetHash: datasetHash(dataset), assets, rosterScope: configured.policy.rosterScope, pipelineDefinition: definition,
    request: request.kind === "train" ? buildWorkerTraining(dataset, request.scoreTarget, sizes, request.recipe!, configured.policy.limits) : buildWorkerInference(dataset, request.caseId!, sizes, { pipelineVersion: modelId, sampler: definition.sampler, roster, limits: configured.policy.limits }) };
  if (Buffer.byteLength(JSON.stringify(payload)) > 6 * 1024 ** 2 || Buffer.byteLength(JSON.stringify(payload.request)) > 4 * 1024 ** 2) throw new OcrLearningError("input_budget_exceeded");
  return getDb().transaction(async (tx) => {
    await lockWorker(tx, request.allianceId);
    const [current] = await tx.select().from(schema.ocrWorkerPolicies).where(eq(schema.ocrWorkerPolicies.allianceId, request.allianceId)).limit(1);
    if (!current?.policy.enabled || current.revision !== configured.revision) throw new OcrLearningError("worker_policy_changed", 409);
    const [duplicate] = await tx.select().from(schema.ocrWorkerJobs).where(and(eq(schema.ocrWorkerJobs.allianceId, request.allianceId), eq(schema.ocrWorkerJobs.requestId, request.requestId))).limit(1);
    if (duplicate) {
      if (duplicate.requestHash !== requestHash || duplicate.createdByHqUserId !== actor.hqUserId) throw new OcrLearningError("worker_request_conflict", 409);
      return { id: duplicate.id, state: duplicate.state, pipelineId: duplicate.pipelineId };
    }
    const fresh = await loadUsableDataset(request.allianceId, request.datasetId, {}, tx);
    if (datasetHash(fresh) !== payload.datasetHash) throw new OcrLearningError("stale_dataset", 409);
    const [queued] = await tx.select({ count: sql<number>`count(*)::integer` }).from(schema.ocrWorkerJobs).where(and(eq(schema.ocrWorkerJobs.allianceId, request.allianceId), inArray(schema.ocrWorkerJobs.state, ["queued", "running"])));
    if (queued.count >= 20) throw new OcrLearningError("worker_queue_limit", 409);
    if (request.kind === "evaluate") {
      if (request.pipelineId) await loadModelVersion(tx, request.allianceId, request.pipelineId);
      else await tx.insert(schema.ocrModelVersions).values({ id: modelId, allianceId: request.allianceId, scoreTarget: request.scoreTarget, definition, createdByHqUserId: actor.hqUserId }).onConflictDoNothing();
      await loadModelVersion(tx, request.allianceId, modelId);
    }
    const id = nanoid();
    const expiresAt = new Date(Math.min(Date.now() + 86400000, ...fresh.entries.map(({ sample }) => new Date(sample.expiresAt).getTime())));
    await tx.insert(schema.ocrWorkerJobs).values({ id, allianceId: request.allianceId, scoreTarget: request.scoreTarget, kind: request.kind, datasetId: request.datasetId, pipelineId: request.kind === "evaluate" ? modelId : null, requestId: request.requestId, requestHash, input: payload, inputHash: workerHash(payload), policyRevision: current.revision, policySnapshot: current.policy, expiresAt, createdByHqUserId: actor.hqUserId });
    await workerAudit(tx, actor, request.allianceId, "ocr.worker.enqueue", id, { kind: request.kind, datasetId: request.datasetId, scoreTarget: request.scoreTarget });
    return { id, state: "queued" as const, pipelineId: request.kind === "evaluate" ? modelId : null };
  });
}

export async function revokeModelVersion(allianceId: string, id: string, actor: OcrActor) {
  return getDb().transaction(async (tx) => {
    await lockWorker(tx, allianceId);
    const [model] = await tx.select().from(schema.ocrModelVersions).where(and(eq(schema.ocrModelVersions.id, id), eq(schema.ocrModelVersions.allianceId, allianceId))).limit(1);
    if (!model) throw new OcrLearningError("model_unavailable", 404);
    if (model.state !== "revoked") {
      await tx.update(schema.ocrModelVersions).set({ state: "revoked" }).where(eq(schema.ocrModelVersions.id, id));
      await workerAudit(tx, actor, allianceId, "ocr.model.revoke", id, { scoreTarget: model.scoreTarget });
    }
    return { id, state: "revoked" };
  });
}

export async function cancelWorkerJob(allianceId: string, id: string, actor: OcrActor) {
  if (!ocrIdSchema.safeParse(id).success) throw new OcrLearningError("invalid_worker_job");
  return getDb().transaction(async (tx) => {
    await lockWorker(tx, allianceId);
    const [job] = await tx.select().from(schema.ocrWorkerJobs).where(and(eq(schema.ocrWorkerJobs.id, id), eq(schema.ocrWorkerJobs.allianceId, allianceId))).limit(1);
    if (!job) throw new OcrLearningError("worker_job_not_found", 404);
    if (job.state === "ready") throw new OcrLearningError("worker_job_completed", 409);
    if (job.state !== "revoked") {
      await tx.update(schema.ocrWorkerJobs).set({ state: "revoked", errorCode: "worker_cancelled", leaseToken: null, updatedAt: new Date() }).where(eq(schema.ocrWorkerJobs.id, id));
      await workerAudit(tx, actor, allianceId, "ocr.worker.cancel", id, {});
    }
    return { id, state: "revoked" };
  });
}
