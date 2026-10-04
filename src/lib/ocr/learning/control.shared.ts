import { z } from "zod";
import { ocrHashSchema, ocrIdSchema, ocrTargetSchema } from "../benchmark/types.shared";
import { defaultWorkerLimits, workerLimitsSchema, workerRecipeSchema, workerSamplerSchema, type WorkerInference, type WorkerTraining } from "./worker.shared";

export const workerPolicySchema = z.object({
  enabled: z.boolean(),
  trustedWorkerCodeHash: ocrHashSchema.nullable(),
  dailyReservedSeconds: z.number().int().min(1).max(86400),
  modelStorageBytes: z.number().int().min(256 * 1024 ** 2).max(20 * 1024 ** 3),
  retentionDays: z.number().int().min(1).max(90),
  rosterScope: z.enum(["none", "current-alliance"]),
  limits: workerLimitsSchema,
}).strict().refine((policy) => !policy.enabled || policy.trustedWorkerCodeHash !== null, "worker_build_required");
export const disabledWorkerPolicy: z.infer<typeof workerPolicySchema> = { enabled: false, trustedWorkerCodeHash: null, dailyReservedSeconds: 3600, modelStorageBytes: 2 * 1024 ** 3, retentionDays: 30, rosterScope: "none", limits: defaultWorkerLimits };

export const pipelineDefinitionSchema = z.object({
  version: z.literal(1), scoreTarget: ocrTargetSchema, workerCodeHash: ocrHashSchema,
  family: z.literal("paddle-v5-mobile-rec"), sampler: workerSamplerSchema,
  artifactSha256: ocrHashSchema.nullable(),
}).strict();

export const workerJobRequestSchema = z.object({
  allianceId: ocrIdSchema, datasetId: ocrIdSchema, scoreTarget: ocrTargetSchema,
  kind: z.enum(["train", "evaluate"]), requestId: ocrIdSchema, confirmed: z.literal(true),
  caseId: ocrIdSchema.optional(), pipelineId: ocrIdSchema.optional(), recipe: workerRecipeSchema.optional(),
  sampler: workerSamplerSchema.default({ mode: "coverage", minShiftFraction: 0.12, maxGapSeconds: 1.5, maxSelectedFrames: 100 }),
}).strict().refine((input) => input.kind === "train" ? Boolean(input.recipe) && !input.caseId && !input.pipelineId : Boolean(input.caseId) && !input.recipe, "invalid_worker_job");

export type WorkerPolicy = z.infer<typeof workerPolicySchema>;
export type PipelineDefinition = z.infer<typeof pipelineDefinitionSchema>;
export type WorkerJobRequest = z.infer<typeof workerJobRequestSchema>;
export type WorkerJobState = "queued" | "running" | "ready" | "failed" | "revoked";
export type WorkerAsset = { sha256: string; bytes: number; storageKey: string; caseId: string };
export type WorkerJobInput = { request: WorkerInference | WorkerTraining; assets: WorkerAsset[]; datasetHash: string; rosterScope: WorkerPolicy["rosterScope"]; pipelineDefinition: PipelineDefinition };
