import { z } from "zod";
import { ocrBoxSchema, ocrEvidenceSchema, ocrHashSchema, ocrIdSchema, ocrPredictionSchema, ocrTargetSchema } from "../benchmark/types.shared";

export const workerLimitsSchema = z.object({
  maxSeconds: z.number().int().min(1).max(3600),
  maxMemoryBytes: z.number().int().min(256 * 1024 ** 2).max(32 * 1024 ** 3),
  maxFrames: z.number().int().min(1).max(2000),
  maxInputBytes: z.number().int().min(1).max(2 * 1024 ** 3),
  maxWorkBytes: z.number().int().min(256 * 1024 ** 2).max(16 * 1024 ** 3).default(4 * 1024 ** 3),
  maxOutputBytes: z.number().int().min(1).max(2 * 1024 ** 3).default(256 * 1024 ** 2),
}).strict();
export const defaultWorkerLimits: z.infer<typeof workerLimitsSchema> = { maxSeconds: 300, maxMemoryBytes: 4 * 1024 ** 3, maxFrames: 1000, maxInputBytes: 512 * 1024 ** 2, maxWorkBytes: 4 * 1024 ** 3, maxOutputBytes: 256 * 1024 ** 2 };

export const workerFrameSchema = z.object({
  sha256: ocrHashSchema, bytes: z.number().int().min(1).max(20 * 1024 ** 2),
  timestampSeconds: z.number().finite().min(0).max(86400).nullable(),
  width: z.number().int().min(1).max(10000), height: z.number().int().min(1).max(10000),
}).strict().refine((frame) => frame.width * frame.height <= 6_000_000, "pixel_budget_exceeded");
export const workerRosterSchema = z.array(z.object({ memberId: ocrIdSchema, name: z.string().min(1).max(160), aliases: z.array(z.string().max(160)).max(30).default([]) }).strict()).max(500);
export const workerSamplerSchema = z.object({
  mode: z.enum(["all", "coverage"]).default("coverage"),
  minShiftFraction: z.number().finite().gt(0).max(1).default(0.12),
  maxGapSeconds: z.number().finite().gt(0).max(30).default(1.5),
  maxSelectedFrames: z.number().int().min(1).max(100).default(100),
}).strict();
export const workerInferenceSchema = z.object({
  version: z.literal(1), caseId: ocrIdSchema, scoreTarget: ocrTargetSchema, sourceSha256: ocrHashSchema,
  pipelineVersion: z.string().min(1).max(128), frames: z.array(workerFrameSchema).min(1).max(2000),
  roster: workerRosterSchema.default([]), sampler: workerSamplerSchema, limits: workerLimitsSchema,
}).strict().refine((input) => input.frames.length <= input.limits.maxFrames && input.frames.reduce((sum, frame) => sum + frame.bytes, 0) <= input.limits.maxInputBytes && new Set(input.frames.map((frame) => frame.sha256)).size === input.frames.length, "input_budget_exceeded");

export const workerRecipeSchema = z.object({
  family: z.literal("paddle-v5-mobile-rec"), epochs: z.number().int().min(1).max(20), batchSize: z.number().int().min(1).max(64),
  learningRate: z.number().finite().gt(0).max(0.01), seed: z.number().int().min(0).max(2 ** 31 - 1),
}).strict();
export const workerCellLabelSchema = z.object({ frameSha256: ocrHashSchema, box: ocrBoxSchema, text: z.string().min(1).max(160).refine((value) => !/[\u0000-\u001f]/.test(value), "invalid_label_text"), field: z.enum(["name", "score"]) }).strict()
  .refine((label) => label.field !== "score" || /^\d+$/.test(label.text), "invalid_score_label");
export const workerTrainingExampleSchema = z.object({
  caseId: ocrIdSchema, recordingGroupId: ocrIdSchema, sourceSha256: ocrHashSchema, lineageHashes: z.array(ocrHashSchema).max(100).default([]), split: z.enum(["train", "validation"]),
  frames: z.array(workerFrameSchema).min(1).max(2000), labels: z.array(workerCellLabelSchema).min(1).max(2000),
}).strict().refine((example) => example.labels.every((label) => example.frames.some((frame) => frame.sha256 === label.frameSha256)), "missing_label_evidence");
export const workerTrainingSchema = z.object({
  version: z.literal(1), datasetHash: ocrHashSchema, scoreTarget: ocrTargetSchema,
  examples: z.array(workerTrainingExampleSchema).min(1).max(200), recipe: workerRecipeSchema, limits: workerLimitsSchema,
}).strict().superRefine((input, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const splits = new Map<string, string>(), frames = new Map<string, number>();
  if (new Set(input.examples.map((example) => example.split)).size !== 2) fail("training_and_validation_required");
  if (input.examples.reduce((sum, example) => sum + example.labels.length, 0) > 10000) fail("label_budget_exceeded");
  for (const example of input.examples) {
    const fingerprints = [`group:${example.recordingGroupId}`, ...[example.sourceSha256, ...example.lineageHashes, ...example.frames.map((frame) => frame.sha256)].map((hash) => `hash:${hash}`)];
    for (const fingerprint of fingerprints) {
      if (splits.has(fingerprint) && splits.get(fingerprint) !== example.split) fail("split_leakage");
      splits.set(fingerprint, example.split);
    }
    for (const frame of example.frames) {
      if (frames.has(frame.sha256) && frames.get(frame.sha256) !== frame.bytes) fail("artifact_hash_conflict");
      frames.set(frame.sha256, frame.bytes);
    }
  }
  if (frames.size > input.limits.maxFrames || [...frames.values()].reduce((sum, bytes) => sum + bytes, 0) > input.limits.maxInputBytes) fail("input_budget_exceeded");
});

export const workerInferenceResultSchema = z.object({
  prediction: ocrPredictionSchema, samplingBudgetLimited: z.boolean(), workerCodeHash: ocrHashSchema,
  samplerFeatures: z.array(z.object({ sha256: ocrHashSchema, timestampSeconds: z.number().finite().nonnegative(), sharpness: z.number().finite().nonnegative(), verticalMotion: z.number().finite(), motionConfidence: z.number().finite().min(0).max(1), sceneChange: z.boolean() }).strict()).max(2000),
  observations: z.array(z.object({ name: z.string().max(160), score: z.string().max(128).nullable(), rank: z.number().int().positive().nullable(), memberId: ocrIdSchema.nullable(), confidence: z.number().finite().min(0).max(1), evidence: ocrEvidenceSchema }).strict()).max(200000),
}).strict();

export const workerTrainingResultSchema = z.object({
  manifest: z.object({ version: z.literal(1), family: z.literal("paddle-v5-mobile-rec"), datasetHash: ocrHashSchema,
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), workerCodeHash: ocrHashSchema, baseModelSha256: ocrHashSchema,
    recipe: workerRecipeSchema, updatedTensors: z.number().int().positive(),
    samples: z.object({ train: z.number().int().positive(), validation: z.number().int().positive() }).strict(),
    files: z.record(z.string().regex(/^[a-zA-Z0-9_.-]+$/), ocrHashSchema).refine((files) => {
      const allowed = new Set(["inference.json", "inference.pdmodel", "inference.pdiparams", "inference.pdiparams.info", "inference.yml"]);
      return Object.keys(files).every((name) => allowed.has(name)) && Boolean(files["inference.pdiparams"] && files["inference.yml"] && (files["inference.json"] || files["inference.pdmodel"]));
    }, "invalid_model_manifest"),
  }).strict(),
  artifactSha256: ocrHashSchema, totalMs: z.number().finite().nonnegative(), checkpointSha256: ocrHashSchema, workerCodeHash: ocrHashSchema,
}).strict().refine((result) => result.workerCodeHash === result.manifest.workerCodeHash, "worker_build_mismatch");

export type WorkerLimits = z.infer<typeof workerLimitsSchema>;
export type WorkerSampler = z.infer<typeof workerSamplerSchema>;
export type WorkerFrame = z.infer<typeof workerFrameSchema>;
export type WorkerInference = z.infer<typeof workerInferenceSchema>;
export type WorkerRecipe = z.infer<typeof workerRecipeSchema>;
export type WorkerTraining = z.infer<typeof workerTrainingSchema>;
export type WorkerInferenceResult = z.infer<typeof workerInferenceResultSchema>;
export type WorkerTrainingResult = z.infer<typeof workerTrainingResultSchema>;
