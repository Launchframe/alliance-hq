import { z } from "zod";
import { ocrHashSchema, ocrIdSchema, ocrTargetSchema } from "../benchmark/types.shared";

export const ocrMediaPolicySchema = z.object({
  enabled: z.boolean(),
  dataPermissionApproved: z.boolean(),
  storageBudgetBytes: z.number().int().min(0).max(20 * 1024 ** 3),
  sourceLimitBytes: z.number().int().min(1).max(512 * 1024 ** 2),
  retentionDays: z.number().int().min(1).max(90),
  maxFrames: z.number().int().min(1).max(100),
}).strict().refine((value) => !value.enabled || value.dataPermissionApproved && value.storageBudgetBytes >= value.sourceLimitBytes * 2);

export type OcrMediaPolicy = z.infer<typeof ocrMediaPolicySchema>;
export const disabledMediaPolicy: OcrMediaPolicy = { enabled: false, dataPermissionApproved: false, storageBudgetBytes: 0, sourceLimitBytes: 128 * 1024 ** 2, retentionDays: 30, maxFrames: 80 };

export const mediaUploadSchema = z.object({
  allianceId: ocrIdSchema,
  scoreTarget: ocrTargetSchema,
  fileName: z.string().min(1).max(255).refine((name) => !/[\\/\u0000-\u001f]/.test(name)),
  contentType: z.enum(["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png"]),
  bytes: z.number().int().min(1).max(512 * 1024 ** 2),
  sha256: ocrHashSchema,
  requestId: ocrIdSchema,
}).strict();

export type OcrMediaUpload = z.infer<typeof mediaUploadSchema>;
export type OcrMediaTaskState = "uploading" | "queued" | "running" | "ready" | "failed" | "revoked";
export type OcrMediaObjectState = "reserved" | "ready" | "garbage" | "deleted";

export const mediaExtension = (contentType: OcrMediaUpload["contentType"]) => ({
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "image/jpeg": ".jpg", "image/png": ".png",
} as const)[contentType];
