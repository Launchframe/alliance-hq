import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { OcrLearningError } from "../benchmark/types.shared";
import { evaluatePrediction } from "../benchmark/metrics.shared";
import { sealWorkerArtifact } from "./control-artifacts.server";
import { leasedWorkerJob } from "./control-leases.server";
import { lockWorker, pipelineId, workerAudit, workerHash } from "./control-policy.server";
import { loadModelVersion } from "./control-jobs.server";
import { workerInferenceResultSchema, workerTrainingResultSchema } from "./worker.shared";

export async function completeWorkerJob(id: string, token: string, output: unknown, artifactId?: string) {
  const [peek] = await getDb().select().from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.id, id)).limit(1);
  if (!peek) throw new OcrLearningError("worker_job_not_found", 404);
  const parsed = peek.kind === "train" ? workerTrainingResultSchema.safeParse(output) : workerInferenceResultSchema.safeParse(output);
  if (!parsed.success) throw new OcrLearningError("invalid_worker_result");
  const result = parsed.data;
  const resultHash = workerHash({ result, artifactId: artifactId ?? null });
  if (peek.state === "ready") {
    if (peek.leaseToken !== token || peek.resultHash !== resultHash) throw new OcrLearningError("worker_result_conflict", 409);
    return { id, state: "ready", pipelineId: peek.pipelineId };
  }
  if (peek.kind === "train" && !artifactId || peek.kind !== "train" && artifactId) throw new OcrLearningError("worker_artifact_required", 409);
  if (artifactId) await sealWorkerArtifact(artifactId, id, token);
  return getDb().transaction(async (tx) => {
    await lockWorker(tx, peek.allianceId);
    const [current] = await tx.select().from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.id, id)).limit(1);
    if (current.state === "ready") {
      if (current.leaseToken !== token || current.resultHash !== resultHash) throw new OcrLearningError("worker_result_conflict", 409);
      return { id, state: "ready", pipelineId: current.pipelineId };
    }
    const { job, dataset } = await leasedWorkerJob(tx, id, token);
    if (result.workerCodeHash !== job.input.pipelineDefinition.workerCodeHash) throw new OcrLearningError("worker_build_mismatch", 409);
    let modelId = job.pipelineId;
    let metrics: Record<string, unknown> | null = null;
    if ("prediction" in result) {
      if (job.kind !== "evaluate" || !("caseId" in job.input.request) || result.samplingBudgetLimited) throw new OcrLearningError("sampling_budget_limited", 409);
      const request = job.input.request;
      const prediction = result.prediction;
      if (prediction.caseId !== request.caseId || prediction.pipelineVersion !== request.pipelineVersion || prediction.sourceSha256 !== request.sourceSha256 || prediction.scoreTarget !== job.scoreTarget) throw new OcrLearningError("prediction_scope_mismatch", 409);
      const sample = dataset.entries.find((entry) => entry.sample.id === request.caseId)?.sample;
      if (!sample) throw new OcrLearningError("case_not_found", 404);
      const frameTimes = new Map(request.frames.map((frame) => [frame.sha256, frame.timestampSeconds]));
      const sourceTimes = new Set(frameTimes.values());
      const evidence = [...prediction.rows.flatMap((row) => row.evidence), ...result.observations.map((row) => row.evidence), ...result.samplerFeatures.map((frame) => ({ frameSha256: frame.sha256, timestampSeconds: frame.timestampSeconds }))];
      if (evidence.some((item) => !frameTimes.has(item.frameSha256) || frameTimes.get(item.frameSha256) !== item.timestampSeconds) || prediction.selectedTimestamps.some((time) => !sourceTimes.has(time))) throw new OcrLearningError("invalid_prediction_evidence", 409);
      metrics = { ...evaluatePrediction(sample, prediction) };
    } else {
      if (job.kind !== "train" || !("recipe" in job.input.request)) throw new OcrLearningError("invalid_worker_result");
      const [artifact] = await tx.select().from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.id, artifactId!), eq(schema.ocrWorkerArtifacts.jobId, id))).limit(1);
      if (!artifact || artifact.state !== "sealed" || artifact.attempt !== job.attempts || artifact.manifestHash !== result.artifactSha256 || workerHash(JSON.parse(artifact.manifestText)) !== workerHash(result.manifest)) throw new OcrLearningError("artifact_digest_mismatch", 409);
      if (result.manifest.datasetHash !== job.input.datasetHash || workerHash(result.manifest.recipe) !== workerHash(job.input.request.recipe)) throw new OcrLearningError("artifact_scope_mismatch", 409);
      const definition = { ...job.input.pipelineDefinition, artifactSha256: result.artifactSha256 };
      modelId = pipelineId(job.allianceId, definition);
      await tx.insert(schema.ocrModelVersions).values({ id: modelId, allianceId: job.allianceId, scoreTarget: job.scoreTarget, definition, trainingJobId: id, datasetId: job.datasetId, artifactId: artifact.id, createdByHqUserId: job.createdByHqUserId }).onConflictDoNothing();
    }
    if (modelId) await loadModelVersion(tx, job.allianceId, modelId);
    await tx.update(schema.ocrWorkerJobs).set({ state: "ready", pipelineId: modelId, result, metrics, resultHash, errorCode: null, updatedAt: new Date() }).where(eq(schema.ocrWorkerJobs.id, id));
    await tx.update(schema.ocrWorkerAttempts).set({ finishedAt: new Date() }).where(and(eq(schema.ocrWorkerAttempts.jobId, id), eq(schema.ocrWorkerAttempts.attempt, job.attempts)));
    await workerAudit(tx, { hqUserId: job.createdByHqUserId! }, job.allianceId, "ocr.worker.complete", id, { kind: job.kind, scoreTarget: job.scoreTarget, pipelineId: modelId });
    return { id, state: "ready", pipelineId: modelId };
  });
}
