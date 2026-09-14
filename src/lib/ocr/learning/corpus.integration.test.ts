import { afterAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { assertE2eDatabaseUrl } from "../../../../scripts/e2e-database-url-guard.mjs";
import { createNativeAlliance, createPlatformMaintainerSession, getE2eSql, closeE2eSql } from "../../../../e2e/fixtures/db";
import { getDb, getSqlClient, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { ocrCaseFixture } from "@/test/ocr-corpus";
import { confirmCasePair, createCandidateCase, freezeDataset, loadUsableDataset, reviseCaseLabels, revokeLearningCase } from "./corpus.server";

let usedDatabase = false;
async function setup() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== process.env.E2E_DATABASE_URL?.trim()) throw new Error("test_database_mismatch");
  usedDatabase = true;
  const sql = getE2eSql();
  const user = await createPlatformMaintainerSession(sql);
  const { allianceId } = await createNativeAlliance(sql, { tag: `OCR${nanoid(5)}`, name: "OCR fixture", ownerHqUserId: user.hqUserId });
  const actor = { hqUserId: user.hqUserId, sessionId: user.sessionId };
  async function createCase(verify = true) {
    const id = nanoid(), jobId = nanoid();
    await getDb().insert(schema.videoJobs).values({ id: jobId, sessionId: user.sessionId, allianceId, scoreTarget: "vs-performance", status: "complete" });
    const sample = ocrCaseFixture(id, { allianceId, expiresAt: new Date(Date.now() + 86400000).toISOString(), state: "candidate", labelRevision: 0, privacyReviewed: false, pairing: "unmatched", jobId: null });
    await createCandidateCase({ sample, sourceStorageKey: `ocr-learning/${allianceId}/${id}/source.mp4`, sourceBytes: 1000, fileName: "source.mp4" }, actor);
    if (!verify) return { sample, jobId };
    await confirmCasePair({ allianceId, caseId: id, jobId, expectedRevision: 0, confirmed: true }, actor);
    return { sample: await reviseCaseLabels({ allianceId, caseId: id, expectedRevision: 1, labels: sample.labels, verify: true, privacyReviewed: true, externalTrainingAllowed: false }, actor), jobId };
  }
  return { allianceId, actor, createCase };
}

describe.skipIf(process.env.OCR_LEARNING_DB_TEST !== "1")("OCR corpus with guarded database", () => {
  afterAll(async () => { await closeE2eSql(); if (usedDatabase) await getSqlClient().end({ timeout: 5 }); });

  it("freezes idempotently and keeps label revisions immutable", async () => {
    const f = await setup();
    const { sample } = await f.createCase();
    const request = { allianceId: f.allianceId, cases: [{ id: sample.id, revision: sample.labelRevision, split: "train" as const }] };
    const [a, b] = await Promise.all([freezeDataset(request, f.actor), freezeDataset(request, f.actor)]);
    expect(a.id).toBe(b.id);
    const changed = sample.labels.map((row) => ({ ...row, score: "0" }));
    await reviseCaseLabels({ allianceId: f.allianceId, caseId: sample.id, expectedRevision: sample.labelRevision, labels: changed, verify: true, privacyReviewed: true, externalTrainingAllowed: false }, f.actor);
    const [frozen] = await getDb().select().from(schema.ocrDatasetVersions).where(eq(schema.ocrDatasetVersions.id, a.id));
    expect(frozen.manifest.entries[0].sample.labels[0].score).toBe("1234567");
    const history = await getDb().select().from(schema.ocrLearningCaseRevisions).where(eq(schema.ocrLearningCaseRevisions.caseId, sample.id));
    expect(history.map((row) => row.revision).sort()).toEqual([0, 1, 2, 3]);
    await expect(loadUsableDataset(f.allianceId, a.id)).rejects.toMatchObject({ code: "stale_dataset" });
    await expect(freezeDataset(request, f.actor)).rejects.toMatchObject({ code: "stale_case" });
  });

  it("prevents train/test leakage across successive dataset versions", async () => {
    const f = await setup();
    const { sample: a } = await f.createCase();
    await freezeDataset({ allianceId: f.allianceId, cases: [{ id: a.id, revision: a.labelRevision, split: "test" }] }, f.actor);
    const { sample: b } = await f.createCase();
    await expect(freezeDataset({ allianceId: f.allianceId, cases: [{ id: b.id, revision: b.labelRevision, split: "train" }] }, f.actor)).rejects.toMatchObject({ code: "split_leakage" });
    const rows = await getDb().select().from(schema.ocrDatasetVersions).where(eq(schema.ocrDatasetVersions.allianceId, f.allianceId));
    expect(rows).toHaveLength(1);
  });

  it("rejects foreign cases, stale edits, revoked data and unapproved external use", async () => {
    const f = await setup();
    const { sample } = await f.createCase();
    const dataset = await freezeDataset({ allianceId: f.allianceId, cases: [{ id: sample.id, revision: sample.labelRevision, split: "test" }] }, f.actor);
    await expect(loadUsableDataset(f.allianceId, dataset.id, { external: true })).rejects.toMatchObject({ code: "data_permission_required" });
    await expect(freezeDataset({ allianceId: "foreign", cases: [{ id: sample.id, revision: sample.labelRevision, split: "test" }] }, f.actor)).rejects.toMatchObject({ code: "case_not_found" });
    await expect(reviseCaseLabels({ allianceId: f.allianceId, caseId: sample.id, expectedRevision: 0, labels: [], verify: false, privacyReviewed: false, externalTrainingAllowed: false }, f.actor)).rejects.toMatchObject({ code: "stale_case" });
    await revokeLearningCase(f.allianceId, sample.id, sample.labelRevision, f.actor);
    await expect(loadUsableDataset(f.allianceId, dataset.id)).rejects.toMatchObject({ code: "revoked_case" });
  });

  it("requires explicit pairing and rejects a different tenant or score target", async () => {
    const f = await setup(), other = await setup();
    const { sample, jobId } = await f.createCase(false);
    const foreign = await other.createCase(false);
    const input = { allianceId: f.allianceId, caseId: sample.id, jobId: foreign.jobId, expectedRevision: 0, confirmed: true as const };
    await expect(confirmCasePair(input, f.actor)).rejects.toMatchObject({ code: "job_mismatch" });
    await getDb().update(schema.videoJobs).set({ scoreTarget: "alliance-kills-video" }).where(eq(schema.videoJobs.id, jobId));
    await expect(confirmCasePair({ ...input, jobId }, f.actor)).rejects.toMatchObject({ code: "job_mismatch" });
    const [unchanged] = await getDb().select().from(schema.ocrLearningCases).where(eq(schema.ocrLearningCases.id, sample.id));
    expect(unchanged.pairing).toBe("unmatched");
    expect(unchanged.labelRevision).toBe(0);
  });
});
