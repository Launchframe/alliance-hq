import "server-only";

import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { copyObjectBounded, deleteObject, getObjectSize, getObjectStream } from "@/lib/storage";
import { OcrLearningError, ocrHashSchema, ocrIdSchema, ocrStorageKeySchema } from "../benchmark/types.shared";

export type SealedObject = { storageKey: string; sha256: string; bytes: number };
export type OcrMediaExtension = ".mp4" | ".mov" | ".webm" | ".jpg" | ".png" | ".bin";

export function assertCaptureSourceKey(allianceId: string, sourceKey: string): void {
  if (!/^[a-zA-Z0-9_./-]+$/.test(sourceKey) || sourceKey.split("/").some((part) => !part || part === "." || part === "..") || !(sourceKey.startsWith(`ocr-staging/${allianceId}/`) || sourceKey.startsWith("videos/"))) throw new OcrLearningError("invalid_source_key");
}

export async function hashStoredObject(storageKey: string, maxBytes: number): Promise<{ sha256: string; bytes: number }> {
  if (!ocrStorageKeySchema.safeParse(storageKey.replace(/^ocr-staging\//, "ocr-learning/")).success || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new OcrLearningError("invalid_media");
  const reader = (await getObjectStream(storageKey, undefined, AbortSignal.timeout(60000))).getReader();
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > maxBytes) { await reader.cancel(); throw new OcrLearningError("source_size_limit"); }
      hash.update(chunk.value);
    }
    return { sha256: hash.digest("hex"), bytes };
  } finally { reader.releaseLock(); }
}

export async function sealStoredObject(input: {
  allianceId: string; caseId: string; sourceKey: string; extension: OcrMediaExtension; maxBytes: number; expectedSha256?: string; destinationKey?: string;
}): Promise<SealedObject> {
  if (!ocrIdSchema.safeParse(input.allianceId).success || !ocrIdSchema.safeParse(input.caseId).success) throw new OcrLearningError("invalid_scope");
  assertCaptureSourceKey(input.allianceId, input.sourceKey);
  if (![".mp4", ".mov", ".webm", ".jpg", ".png", ".bin"].includes(input.extension) || !Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0 || (input.expectedSha256 != null && !ocrHashSchema.safeParse(input.expectedSha256).success)) throw new OcrLearningError("invalid_media");
  const sourceBytes = await getObjectSize(input.sourceKey, AbortSignal.timeout(30000));
  if (sourceBytes <= 0 || sourceBytes > input.maxBytes) throw new OcrLearningError("source_size_limit");
  const storageKey = input.destinationKey ?? `ocr-learning/${input.allianceId}/${input.caseId}/${nanoid()}${input.extension}`;
  if (!ocrStorageKeySchema.safeParse(storageKey).success || !storageKey.startsWith(`ocr-learning/${input.allianceId}/${input.caseId}/`)) throw new OcrLearningError("invalid_media");
  try {
    await copyObjectBounded(input.sourceKey, storageKey, input.maxBytes);
    const digest = await hashStoredObject(storageKey, input.maxBytes);
    if (digest.bytes !== sourceBytes || input.expectedSha256 && digest.sha256 !== input.expectedSha256) throw new OcrLearningError("source_hash_mismatch", 409);
    return { storageKey, ...digest };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) await deleteObject(storageKey, AbortSignal.timeout(30000));
    throw error;
  }
}
