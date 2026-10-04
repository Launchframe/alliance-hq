import "server-only";

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { getMaxVideoUploadBytes } from "@/lib/video/upload-limit";
import { buildDataset, caseFingerprintKeys, datasetHash, stableJson } from "../benchmark/dataset.server";
import { validateCaseEvidence } from "../benchmark/evidence.shared";
import { OcrLearningError, ocrCaseSchema, ocrIdSchema, ocrLabelSchema, ocrSplitSchema, ocrStorageKeySchema, type OcrCase, type OcrTarget } from "../benchmark/types.shared";

export type OcrActor = { hqUserId: string; sessionId?: string };
type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type CaseRow = typeof schema.ocrLearningCases.$inferSelect;
const snapshotHash = (value: OcrCase) => createHash("sha256").update(stableJson(value)).digest("hex");

async function lockCorpus(tx: Transaction, allianceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ocr-corpus:${allianceId}`}))`);
}

async function audit(tx: Transaction, actor: OcrActor, allianceId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ id: nanoid(), hqUserId: actor.hqUserId, sessionId: actor.sessionId, allianceId, action, severity: "update", resourceType: "ocr_learning", resourceId, metadata });
}

function checkedSnapshot(row: CaseRow): OcrCase {
  const parsed = ocrCaseSchema.safeParse(row.snapshot);
  if (!parsed.success) throw new OcrLearningError("corrupt_case", 409);
  const value = parsed.data;
  if (value.id !== row.id || value.allianceId !== row.allianceId || value.scoreTarget !== row.scoreTarget || value.jobId !== row.sourceJobId || value.sourceSha256 !== row.sourceSha256 || value.recordingGroupId !== row.recordingGroupId || value.labelRevision !== row.labelRevision || value.state !== row.state || value.pairing !== row.pairing || new Date(value.expiresAt).getTime() !== row.expiresAt.getTime() || snapshotHash(value) !== row.snapshotHash) throw new OcrLearningError("corrupt_case", 409);
  return value;
}

export async function listLearningCases(allianceId: string, target?: OcrTarget) {
  return getDb().select({ id: schema.ocrLearningCases.id, allianceId: schema.ocrLearningCases.allianceId, scoreTarget: schema.ocrLearningCases.scoreTarget, sourceJobId: schema.ocrLearningCases.sourceJobId, fileName: schema.ocrLearningCases.fileName, sourceBytes: schema.ocrLearningCases.sourceBytes, pairing: schema.ocrLearningCases.pairing, state: schema.ocrLearningCases.state, labelRevision: schema.ocrLearningCases.labelRevision, expiresAt: schema.ocrLearningCases.expiresAt })
    .from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.allianceId, allianceId), target ? eq(schema.ocrLearningCases.scoreTarget, target) : undefined)).orderBy(asc(schema.ocrLearningCases.id)).limit(200);
}

export async function createCandidateCase(input: { sample: OcrCase; sourceStorageKey: string; sourceBytes: number; fileName: string }, actor: OcrActor, transaction?: Transaction) {
  const parsed = ocrCaseSchema.safeParse(input.sample);
  if (!parsed.success || !ocrStorageKeySchema.safeParse(input.sourceStorageKey).success) throw new OcrLearningError("invalid_case");
  const sample = parsed.data;
  if (sample.state !== "candidate" || sample.labelRevision !== 0 || sample.privacyReviewed || sample.externalTrainingAllowed || sample.pairing !== "unmatched" || sample.jobId !== null) throw new OcrLearningError("invalid_case");
  if (!input.sourceStorageKey.startsWith(`ocr-learning/${sample.allianceId}/`)) throw new OcrLearningError("tenant_mismatch", 403);
  if (!Number.isSafeInteger(input.sourceBytes) || input.sourceBytes <= 0 || input.sourceBytes > getMaxVideoUploadBytes()) throw new OcrLearningError("input_limit");
  if (new Date(sample.expiresAt).getTime() <= Date.now() || new Date(sample.expiresAt).getTime() > Date.now() + 90 * 86400000) throw new OcrLearningError("invalid_retention");
  const fileName = input.fileName.split(/[\\/]/).at(-1)?.trim();
  if (!fileName || fileName.length > 255) throw new OcrLearningError("invalid_file_name");
  const persist = async (tx: Transaction) => {
    await lockCorpus(tx, sample.allianceId);
    const [existing] = await tx.select().from(schema.ocrLearningCases).where(eq(schema.ocrLearningCases.id, sample.id)).limit(1);
    if (existing) {
      if (existing.allianceId !== sample.allianceId || existing.scoreTarget !== sample.scoreTarget || existing.sourceSha256 !== sample.sourceSha256 || existing.sourceStorageKey !== input.sourceStorageKey || existing.sourceBytes !== input.sourceBytes || existing.snapshot.sourceKind !== sample.sourceKind) throw new OcrLearningError("case_conflict", 409);
      return checkedSnapshot(existing);
    }
    const hash = snapshotHash(sample);
    await tx.insert(schema.ocrLearningCases).values({
      id: sample.id, allianceId: sample.allianceId, scoreTarget: sample.scoreTarget, sourceJobId: sample.jobId,
      sourceStorageKey: input.sourceStorageKey, sourceSha256: sample.sourceSha256, sourceBytes: input.sourceBytes,
      fileName, recordingGroupId: sample.recordingGroupId, state: sample.state, pairing: sample.pairing,
      labelRevision: sample.labelRevision, snapshot: sample, snapshotHash: hash, expiresAt: new Date(sample.expiresAt), createdByHqUserId: actor.hqUserId,
    });
    await tx.insert(schema.ocrLearningCaseRevisions).values({ caseId: sample.id, revision: 0, snapshot: sample, snapshotHash: hash, recordedByHqUserId: actor.hqUserId });
    await audit(tx, actor, sample.allianceId, "ocr.case.capture", sample.id, { scoreTarget: sample.scoreTarget, sourceJobId: sample.jobId });
    return sample;
  };
  return transaction ? persist(transaction) : getDb().transaction(persist);
}

export async function loadLearningCase(allianceId: string, caseId: string) {
  const [row] = await getDb().select().from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.id, caseId), eq(schema.ocrLearningCases.allianceId, allianceId))).limit(1);
  if (!row) throw new OcrLearningError("case_not_found", 404);
  return checkedSnapshot(row);
}

export async function loadLearningAsset(allianceId: string, caseId: string, frameSha256?: string) {
  const [row] = await getDb().select().from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.id, caseId), eq(schema.ocrLearningCases.allianceId, allianceId))).limit(1);
  if (!row) throw new OcrLearningError("case_not_found", 404);
  const snapshot = checkedSnapshot(row);
  if (snapshot.state === "revoked" || row.expiresAt <= new Date()) throw new OcrLearningError("media_unavailable", 410);
  const frame = frameSha256 ? snapshot.frames.find((item) => item.sha256 === frameSha256) : null;
  if (frameSha256 && !frame) throw new OcrLearningError("frame_not_found", 404);
  const storageKey = frame?.storageKey ?? row.sourceStorageKey;
  if (!ocrStorageKeySchema.safeParse(storageKey).success || !storageKey.startsWith(`ocr-learning/${allianceId}/`)) throw new OcrLearningError("invalid_media", 409);
  const extension = storageKey.split(".").at(-1)?.toLowerCase();
  const contentType = ({ png: "image/png", jpg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
  return { storageKey, sha256: frame?.sha256 ?? row.sourceSha256, expectedBytes: frame ? null : row.sourceBytes, contentType };
}

const pairInput = z.object({ allianceId: ocrIdSchema, caseId: ocrIdSchema, jobId: ocrIdSchema, expectedRevision: z.number().int().min(0), confirmed: z.literal(true) }).strict();
export async function confirmCasePair(input: z.infer<typeof pairInput>, actor: OcrActor) {
  if (!pairInput.safeParse(input).success) throw new OcrLearningError("confirmation_required");
  return getDb().transaction(async (tx) => {
    await lockCorpus(tx, input.allianceId);
    const [row] = await tx.select().from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.id, input.caseId), eq(schema.ocrLearningCases.allianceId, input.allianceId))).limit(1).for("update");
    if (!row) throw new OcrLearningError("case_not_found", 404);
    if (row.labelRevision !== input.expectedRevision || row.state !== "candidate") throw new OcrLearningError("stale_case", 409);
    const [job] = await tx.select().from(schema.videoJobs).where(eq(schema.videoJobs.id, input.jobId)).limit(1);
    const [alliance] = await tx.select({ externalId: schema.alliances.ashedAllianceId }).from(schema.alliances).where(eq(schema.alliances.id, input.allianceId)).limit(1);
    if (!job || !alliance || !job.allianceId || ![input.allianceId, alliance.externalId].includes(job.allianceId) || (job.scoreTarget ?? job.category) !== row.scoreTarget) throw new OcrLearningError("job_mismatch", 409);
    if (!["review", "complete"].includes(job.status)) throw new OcrLearningError("job_not_reviewable", 409);
    const snapshot: OcrCase = { ...checkedSnapshot(row), jobId: job.id, pairing: "confirmed", recordingGroupId: job.groupId ?? job.id, labelRevision: row.labelRevision + 1, privacyReviewed: false, externalTrainingAllowed: false };
    return persistRevision(tx, row, snapshot, actor, "ocr.case.pair");
  });
}

async function persistRevision(tx: Transaction, row: CaseRow, snapshot: OcrCase, actor: OcrActor, action: string) {
  const hash = snapshotHash(snapshot);
  await tx.insert(schema.ocrLearningCaseRevisions).values({ caseId: row.id, revision: snapshot.labelRevision, snapshot, snapshotHash: hash, recordedByHqUserId: actor.hqUserId });
  await tx.update(schema.ocrLearningCases).set({ snapshot, snapshotHash: hash, labelRevision: snapshot.labelRevision, state: snapshot.state, pairing: snapshot.pairing, sourceJobId: snapshot.jobId, recordingGroupId: snapshot.recordingGroupId, updatedAt: new Date() }).where(eq(schema.ocrLearningCases.id, row.id));
  await audit(tx, actor, row.allianceId, action, row.id, { revision: snapshot.labelRevision, state: snapshot.state });
  return snapshot;
}

const labelsInput = z.object({ allianceId: ocrIdSchema, caseId: ocrIdSchema, expectedRevision: z.number().int().min(0), labels: z.array(ocrLabelSchema).max(300), verify: z.boolean(), privacyReviewed: z.boolean(), externalTrainingAllowed: z.boolean() }).strict();
export async function reviseCaseLabels(input: z.infer<typeof labelsInput>, actor: OcrActor) {
  const parsed = labelsInput.safeParse(input);
  if (!parsed.success) throw new OcrLearningError("invalid_labels");
  return getDb().transaction(async (tx) => {
    await lockCorpus(tx, input.allianceId);
    const [row] = await tx.select().from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.id, input.caseId), eq(schema.ocrLearningCases.allianceId, input.allianceId))).limit(1).for("update");
    if (!row) throw new OcrLearningError("case_not_found", 404);
    if (row.state === "revoked") throw new OcrLearningError("revoked_case", 409);
    if (row.labelRevision !== input.expectedRevision) throw new OcrLearningError("stale_case", 409);
    const snapshot: OcrCase = { ...checkedSnapshot(row), labels: parsed.data.labels, labelRevision: row.labelRevision + 1, state: input.verify ? "verified" : "candidate", privacyReviewed: input.privacyReviewed, externalTrainingAllowed: input.externalTrainingAllowed };
    if (input.verify) buildDataset(input.allianceId, [{ sample: snapshot, split: "train" }], new Date());
    else if (snapshot.labels.length) validateCaseEvidence(snapshot);
    return persistRevision(tx, row, snapshot, actor, "ocr.case.labels");
  });
}

export async function revokeLearningCase(allianceId: string, caseId: string, expectedRevision: number, actor: OcrActor) {
  return getDb().transaction(async (tx) => {
    await lockCorpus(tx, allianceId);
    const [row] = await tx.select().from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.id, caseId), eq(schema.ocrLearningCases.allianceId, allianceId))).limit(1).for("update");
    if (!row) throw new OcrLearningError("case_not_found", 404);
    const snapshot = checkedSnapshot(row);
    if (row.state === "revoked") return snapshot;
    if (row.labelRevision !== expectedRevision) throw new OcrLearningError("stale_case", 409);
    return persistRevision(tx, row, { ...snapshot, state: "revoked", externalTrainingAllowed: false, labelRevision: row.labelRevision + 1 }, actor, "ocr.case.revoke");
  });
}

const freezeInput = z.object({ allianceId: ocrIdSchema, cases: z.array(z.object({ id: ocrIdSchema, revision: z.number().int().min(0), split: ocrSplitSchema }).strict()).min(1).max(200), external: z.boolean().optional() }).strict();
export async function freezeDataset(input: z.infer<typeof freezeInput>, actor: OcrActor) {
  const parsed = freezeInput.safeParse(input);
  if (!parsed.success) throw new OcrLearningError("invalid_dataset");
  const ids = input.cases.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new OcrLearningError("duplicate_case");
  return getDb().transaction(async (tx) => {
    await lockCorpus(tx, input.allianceId);
    const rows = await tx.select().from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.allianceId, input.allianceId), inArray(schema.ocrLearningCases.id, ids))).orderBy(asc(schema.ocrLearningCases.id)).for("update");
    if (rows.length !== ids.length) throw new OcrLearningError("case_not_found", 404);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const manifest = buildDataset(input.allianceId, input.cases.map((item) => {
      const row = byId.get(item.id)!;
      if (row.labelRevision !== item.revision) throw new OcrLearningError("stale_case", 409);
      return { sample: checkedSnapshot(row), split: item.split };
    }), new Date(), { external: input.external });
    const fingerprints = [...new Map(manifest.entries.flatMap(({ sample, split }) => caseFingerprintKeys(sample).map((fingerprint) => [fingerprint, { allianceId: input.allianceId, fingerprint, split }] as const))).values()];
    for (let offset = 0; offset < fingerprints.length; offset += 250) {
      const batch = fingerprints.slice(offset, offset + 250);
      await tx.insert(schema.ocrDatasetPartitions).values(batch).onConflictDoNothing();
      const saved = await tx.select().from(schema.ocrDatasetPartitions).where(and(eq(schema.ocrDatasetPartitions.allianceId, input.allianceId), inArray(schema.ocrDatasetPartitions.fingerprint, batch.map((row) => row.fingerprint))));
      const expected = new Map(batch.map((row) => [row.fingerprint, row.split]));
      if (saved.some((row) => expected.get(row.fingerprint) !== row.split)) throw new OcrLearningError("split_leakage", 409);
    }
    const hash = datasetHash(manifest);
    const [created] = await tx.insert(schema.ocrDatasetVersions).values({ id: hash, allianceId: input.allianceId, manifest, manifestHash: hash, createdByHqUserId: actor.hqUserId }).onConflictDoNothing().returning();
    if (created) await audit(tx, actor, input.allianceId, "ocr.dataset.freeze", hash, { cases: manifest.entries.length, hash });
    return { id: hash, manifestHash: hash, manifest };
  });
}

export async function loadUsableDataset(allianceId: string, datasetId: string, options: { external?: boolean } = {}, transaction?: Transaction) {
  const load = async (tx: Transaction) => {
    await lockCorpus(tx, allianceId);
    const [dataset] = await tx.select().from(schema.ocrDatasetVersions).where(and(eq(schema.ocrDatasetVersions.id, datasetId), eq(schema.ocrDatasetVersions.allianceId, allianceId))).limit(1);
    if (!dataset) throw new OcrLearningError("dataset_not_found", 404);
    if (datasetHash(dataset.manifest) !== dataset.manifestHash) throw new OcrLearningError("corrupt_dataset", 409);
    const ids = dataset.manifest.entries.map(({ sample }) => sample.id);
    const rows = await tx.select().from(schema.ocrLearningCases).where(and(eq(schema.ocrLearningCases.allianceId, allianceId), inArray(schema.ocrLearningCases.id, ids)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const { sample } of dataset.manifest.entries) {
      const current = byId.get(sample.id);
      if (!current || current.state === "revoked" || current.expiresAt <= new Date()) throw new OcrLearningError("revoked_case", 409);
      if (current.labelRevision !== sample.labelRevision || current.snapshotHash !== snapshotHash(sample)) throw new OcrLearningError("stale_dataset", 409);
      checkedSnapshot(current);
    }
    return buildDataset(allianceId, dataset.manifest.entries, new Date(), options);
  };
  return transaction ? load(transaction) : getDb().transaction(load);
}
