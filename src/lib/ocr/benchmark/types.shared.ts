import { z } from "zod";

export const OCR_LEARNING_TARGETS = ["vs-performance", "alliance-kills-video"] as const;
export type OcrTarget = (typeof OCR_LEARNING_TARGETS)[number];
export const ocrTargetSchema = z.enum(OCR_LEARNING_TARGETS);
export const ocrHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ocrIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const coordinate = z.number().finite().min(0).max(1);
export const ocrBoxSchema = z.tuple([coordinate, coordinate, coordinate, coordinate])
  .refine(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1, "invalid_box");
export type OcrBox = z.infer<typeof ocrBoxSchema>;
export const ocrStorageKeySchema = z.string().max(512).regex(/^ocr-learning\/[a-zA-Z0-9_./-]+$/)
  .refine((key) => !key.split("/").some((part) => !part || part === "." || part === ".."), "invalid_storage_key");
const scoreSchema = z.string().regex(/^(?:0|[1-9]\d{0,15})$/)
  .refine((value) => Number.isSafeInteger(Number(value)), "invalid_score");

export const ocrEvidenceSchema = z.object({
  frameSha256: ocrHashSchema,
  timestampSeconds: z.number().finite().min(0).max(86400).nullable(),
  box: ocrBoxSchema.nullable(),
  nameBox: ocrBoxSchema.optional(),
  scoreBox: ocrBoxSchema.optional(),
}).strict();
export type OcrEvidence = z.infer<typeof ocrEvidenceSchema>;

export const ocrLabelSchema = z.object({
  id: ocrIdSchema,
  name: z.string().max(160),
  score: scoreSchema.nullable(),
  memberId: ocrIdSchema.nullable(),
  rank: z.number().int().min(1).max(10000).nullable(),
  readable: z.boolean(),
  evidence: z.array(ocrEvidenceSchema).max(100),
  readableIntervals: z.array(z.object({ start: z.number().finite().min(0), end: z.number().finite().min(0) }).strict()
    .refine(({ start, end }) => start <= end, "invalid_interval")).max(100),
}).strict().refine((row) => !row.readable || Boolean(row.name.trim()) && row.score !== null, "incomplete_label");
export type OcrLabel = z.infer<typeof ocrLabelSchema>;

export const ocrFrameSchema = z.object({
  sha256: ocrHashSchema,
  storageKey: ocrStorageKeySchema,
  timestampSeconds: z.number().finite().min(0).max(86400).nullable(),
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
}).strict();

export const ocrCaseSchema = z.object({
  id: ocrIdSchema,
  allianceId: ocrIdSchema,
  scoreTarget: ocrTargetSchema,
  recordingGroupId: ocrIdSchema,
  sourceSha256: ocrHashSchema,
  lineageHashes: z.array(ocrHashSchema).min(1).max(100),
  sourceKind: z.enum(["original_video", "extracted_frame", "playback_archive"]),
  jobId: ocrIdSchema.nullable(),
  pairing: z.enum(["unmatched", "confirmed", "rejected"]),
  state: z.enum(["candidate", "verified", "excluded", "revoked"]),
  labelRevision: z.number().int().min(0),
  privacyReviewed: z.boolean(),
  externalTrainingAllowed: z.boolean(),
  expiresAt: z.string().datetime(),
  durationSeconds: z.number().finite().positive().max(86400).nullable(),
  context: z.object({
    recordedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    vsPeriod: z.enum(["daily", "weekly"]).optional(),
    language: z.string().max(32).optional(),
    device: z.string().max(80).optional(),
    scrollStyle: z.enum(["slow_steady", "fast", "page_by_page", "chaotic", "variable", "unknown"]).optional(),
  }).strict(),
  frames: z.array(ocrFrameSchema).max(2000),
  labels: z.array(ocrLabelSchema).max(300),
}).strict();
export type OcrCase = z.infer<typeof ocrCaseSchema>;

export const ocrSplitSchema = z.enum(["train", "validation", "test"]);
export type OcrSplit = z.infer<typeof ocrSplitSchema>;
export const ocrDatasetSchema = z.object({
  version: z.literal(1),
  allianceId: ocrIdSchema,
  entries: z.array(z.object({ sample: ocrCaseSchema, split: ocrSplitSchema }).strict()).min(1).max(2000),
}).strict();
export type OcrDataset = z.infer<typeof ocrDatasetSchema>;

export const ocrPredictionSchema = z.object({
  version: z.literal(1),
  caseId: ocrIdSchema,
  scoreTarget: ocrTargetSchema,
  sourceSha256: ocrHashSchema,
  pipelineVersion: z.string().min(1).max(128),
  engine: z.enum(["ashed", "tesseract", "paddleocr", "roboflow", "doctr", "mock"]),
  synthetic: z.boolean(),
  selectedTimestamps: z.array(z.number().finite().min(0).max(86400)).max(10000),
  totalMs: z.number().finite().min(0),
  requests: z.number().int().min(0),
  peakMemoryBytes: z.number().int().min(0).nullable(),
  rows: z.array(z.object({
    name: z.string().max(160),
    score: z.union([z.string().max(128), z.number().finite()]).nullable(),
    memberId: ocrIdSchema.nullable(),
    confidence: z.number().finite().min(0).max(1).nullable(),
    evidence: z.array(ocrEvidenceSchema).max(100),
  }).strict()).max(2000),
}).strict();
export type OcrPrediction = z.infer<typeof ocrPredictionSchema>;

export class OcrLearningError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
    this.name = "OcrLearningError";
  }
}
