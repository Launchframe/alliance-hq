import "server-only";

import { createHash } from "node:crypto";
import { validateCaseEvidence } from "./evidence.shared";
import { OcrLearningError, ocrDatasetSchema, type OcrCase, type OcrDataset, type OcrSplit } from "./types.shared";

import { stableJson } from "./json.shared";
export { stableJson } from "./json.shared";

export function datasetHash(dataset: OcrDataset): string {
  return createHash("sha256").update(stableJson(dataset)).digest("hex");
}

export function caseFingerprintKeys(sample: OcrCase): string[] {
  return [...new Set([
    `group:${sample.recordingGroupId}`,
    ...[sample.sourceSha256, ...sample.lineageHashes, ...sample.frames.map((frame) => frame.sha256)].map((hash) => `hash:${hash}`),
  ])];
}

export function buildDataset(allianceId: string, entries: OcrDataset["entries"], now: Date, options: { external?: boolean } = {}): OcrDataset {
  if (!Number.isFinite(now.getTime())) throw new OcrLearningError("invalid_time");
  const parsed = ocrDatasetSchema.safeParse({ version: 1, allianceId, entries });
  if (!parsed.success) throw new OcrLearningError("invalid_manifest");
  const dataset = parsed.data;
  const splits = new Map<string, OcrSplit>();
  const artifacts = new Map<string, string>();
  const ids = new Set<string>();
  for (const { sample, split } of dataset.entries) {
    if (sample.allianceId !== allianceId) throw new OcrLearningError("tenant_mismatch", 403);
    if (sample.state !== "verified" || sample.labelRevision < 1) throw new OcrLearningError("unverified_case");
    if (sample.pairing !== "confirmed" || !sample.jobId) throw new OcrLearningError("unconfirmed_source");
    if (new Date(sample.expiresAt) <= now) throw new OcrLearningError("expired_case");
    if (!sample.privacyReviewed || options.external && !sample.externalTrainingAllowed) throw new OcrLearningError("data_permission_required", 403);
    if (ids.has(sample.id)) throw new OcrLearningError("duplicate_case");
    ids.add(sample.id);
    validateCaseEvidence(sample);
    for (const fingerprint of caseFingerprintKeys(sample)) {
      const existing = splits.get(fingerprint);
      if (existing != null && existing !== split) throw new OcrLearningError("split_leakage");
      splits.set(fingerprint, split);
    }
    for (const frame of sample.frames) {
      const existing = artifacts.get(frame.storageKey);
      if (existing && existing !== frame.sha256) throw new OcrLearningError("artifact_hash_conflict");
      artifacts.set(frame.storageKey, frame.sha256);
    }
  }
  dataset.entries.sort((a, b) => a.sample.id < b.sample.id ? -1 : a.sample.id > b.sample.id ? 1 : 0);
  return dataset;
}
