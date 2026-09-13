import "server-only";

import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { datasetHash } from "../benchmark/dataset.server";
import { OcrLearningError, ocrHashSchema, ocrIdSchema } from "../benchmark/types.shared";
import { loadUsableDataset } from "./corpus.server";
import { workerPolicySchema } from "./control.shared";
import { loadModelVersion } from "./control-jobs.server";
import { lockWorker, workerHash, workerUsage } from "./control-policy.server";
import { workerInferenceSchema, workerTrainingSchema } from "./worker.shared";
import type { OcrTransaction } from "./recording.server";

async function checkedJobDataset(tx: OcrTransaction, job: typeof schema.ocrWorkerJobs.$inferSelect) {
  if (workerHash(job.input) !== job.inputHash || job.input.pipelineDefinition.workerCodeHash !== job.policySnapshot.trustedWorkerCodeHash) throw new OcrLearningError("corrupt_worker_job", 409);
  const parsed = job.kind === "train" ? workerTrainingSchema.safeParse(job.input.request) : workerInferenceSchema.safeParse(job.input.request);
  if (!parsed.success) throw new OcrLearningError("corrupt_worker_job", 409);
  const dataset = await loadUsableDataset(job.allianceId, job.datasetId, {}, tx);
  if (datasetHash(dataset) !== job.input.datasetHash) throw new OcrLearningError("stale_dataset", 409);
  for (const asset of job.input.assets) {
    const sample = dataset.entries.find((entry) => entry.sample.id === asset.caseId)?.sample;
    if (!sample?.frames.some((frame) => frame.sha256 === asset.sha256 && frame.storageKey === asset.storageKey)) throw new OcrLearningError("corrupt_worker_job", 409);
  }
  if (job.pipelineId) await loadModelVersion(tx, job.allianceId, job.pipelineId);
  return dataset;
}

export async function leasedWorkerJob(tx: OcrTransaction, id: string, leaseToken: string) {
  const [peek] = await tx.select({ allianceId: schema.ocrWorkerJobs.allianceId }).from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.id, id)).limit(1);
  if (!peek) throw new OcrLearningError("worker_job_not_found", 404);
  await lockWorker(tx, peek.allianceId);
  const [job] = await tx.select().from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.id, id)).limit(1).for("update");
  const [configured] = await tx.select().from(schema.ocrWorkerPolicies).where(eq(schema.ocrWorkerPolicies.allianceId, job.allianceId)).limit(1);
  const [owner] = job.createdByHqUserId ? await tx.select({ maintainer: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, job.createdByHqUserId)).limit(1) : [];
  const parsed = workerPolicySchema.safeParse(configured?.policy);
  if (job.state !== "running" || job.leaseToken !== leaseToken || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date() || job.expiresAt <= new Date()) throw new OcrLearningError("stale_worker_lease", 409);
  if (!parsed.success || !parsed.data.enabled || configured!.revision !== job.policyRevision || !owner?.maintainer) throw new OcrLearningError("worker_policy_changed", 409);
  return { job, policy: parsed.data, dataset: await checkedJobDataset(tx, job) };
}

export async function claimWorkerJob(workerCodeHash: string, jobId?: string) {
  if (!ocrHashSchema.safeParse(workerCodeHash).success || jobId !== undefined && !ocrIdSchema.safeParse(jobId).success) throw new OcrLearningError("invalid_worker_build");
  const candidates = await getDb().select({ id: schema.ocrWorkerJobs.id, allianceId: schema.ocrWorkerJobs.allianceId }).from(schema.ocrWorkerJobs)
    .where(and(jobId ? eq(schema.ocrWorkerJobs.id, jobId) : undefined, sql`${schema.ocrWorkerJobs.input}->'pipelineDefinition'->>'workerCodeHash' = ${workerCodeHash}`, or(eq(schema.ocrWorkerJobs.state, "queued"), and(eq(schema.ocrWorkerJobs.state, "running"), lte(schema.ocrWorkerJobs.leaseExpiresAt, new Date())))))
    .orderBy(asc(schema.ocrWorkerJobs.createdAt)).limit(100);
  for (const candidate of candidates) {
    const result = await getDb().transaction(async (tx) => {
      await lockWorker(tx, candidate.allianceId);
      const [job] = await tx.select().from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.id, candidate.id)).limit(1).for("update");
      if (job.state !== "queued" && !(job.state === "running" && job.leaseExpiresAt && job.leaseExpiresAt <= new Date())) return null;
      const block = async (code: string) => {
        await tx.update(schema.ocrWorkerJobs).set({ state: "failed", errorCode: code, leaseToken: null, updatedAt: new Date() }).where(eq(schema.ocrWorkerJobs.id, job.id));
        return null;
      };
      if (job.expiresAt <= new Date() || job.attempts >= 3) return block("worker_job_expired");
      const [configured] = await tx.select().from(schema.ocrWorkerPolicies).where(eq(schema.ocrWorkerPolicies.allianceId, job.allianceId)).limit(1);
      const [owner] = job.createdByHqUserId ? await tx.select({ maintainer: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, job.createdByHqUserId)).limit(1) : [];
      const parsed = workerPolicySchema.safeParse(configured?.policy);
      if (!parsed.success || !parsed.data.enabled || configured!.revision !== job.policyRevision || !owner?.maintainer) return block("worker_policy_changed");
      if (parsed.data.trustedWorkerCodeHash !== workerCodeHash) return null;
      const [active] = await tx.select({ count: sql<number>`count(*)::integer` }).from(schema.ocrWorkerJobs).where(and(eq(schema.ocrWorkerJobs.allianceId, job.allianceId), eq(schema.ocrWorkerJobs.state, "running"), gt(schema.ocrWorkerJobs.leaseExpiresAt, new Date())));
      if (active.count > 0) return null;
      const reservedSeconds = job.input.request.limits.maxSeconds + 300;
      if ((await workerUsage(tx, job.allianceId)).reservedSeconds + reservedSeconds > parsed.data.dailyReservedSeconds) return null;
      try { await checkedJobDataset(tx, job); }
      catch (error) {
        if (!(error instanceof OcrLearningError)) throw error;
        return block(error.code);
      }
      const leaseToken = nanoid(32), attempt = job.attempts + 1;
      const leaseExpiresAt = new Date(Math.min(Date.now() + reservedSeconds * 1000, job.expiresAt.getTime()));
      await tx.insert(schema.ocrWorkerAttempts).values({ id: nanoid(), jobId: job.id, allianceId: job.allianceId, attempt, workerCodeHash, reservedSeconds });
      await tx.update(schema.ocrWorkerJobs).set({ state: "running", attempts: attempt, leaseToken, leaseExpiresAt, errorCode: null, result: null, metrics: null, resultHash: null, updatedAt: new Date() }).where(eq(schema.ocrWorkerJobs.id, job.id));
      return { id: job.id, kind: job.kind, leaseToken, leaseExpiresAt, input: job.input.request, assets: job.input.assets.map(({ sha256, bytes }) => ({ sha256, bytes })), pipelineId: job.pipelineId };
    });
    if (result) return result;
  }
  return null;
}

export async function heartbeatWorkerJob(id: string, token: string) {
  return getDb().transaction(async (tx) => {
    const { job } = await leasedWorkerJob(tx, id, token);
    return { id, leaseExpiresAt: job.leaseExpiresAt };
  });
}

export async function failWorkerJob(id: string, token: string, code: string) {
  const errorCode = /^[a-z_]{1,80}$/.test(code) ? code : "worker_failed";
  return getDb().transaction(async (tx) => {
    const [peek] = await tx.select({ allianceId: schema.ocrWorkerJobs.allianceId }).from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.id, id)).limit(1);
    if (!peek) throw new OcrLearningError("worker_job_not_found", 404);
    await lockWorker(tx, peek.allianceId);
    const [job] = await tx.select().from(schema.ocrWorkerJobs).where(and(eq(schema.ocrWorkerJobs.id, id), eq(schema.ocrWorkerJobs.leaseToken, token), eq(schema.ocrWorkerJobs.state, "running"))).limit(1);
    if (!job) throw new OcrLearningError("stale_worker_lease", 409);
    await tx.update(schema.ocrWorkerJobs).set({ state: "failed", errorCode, leaseToken: null, updatedAt: new Date() }).where(eq(schema.ocrWorkerJobs.id, id));
    await tx.update(schema.ocrWorkerAttempts).set({ finishedAt: new Date() }).where(and(eq(schema.ocrWorkerAttempts.jobId, id), eq(schema.ocrWorkerAttempts.attempt, job.attempts)));
    return { id, state: "failed" };
  });
}
