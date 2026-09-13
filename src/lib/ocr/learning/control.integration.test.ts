import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { assertE2eDatabaseUrl } from "../../../../scripts/e2e-database-url-guard.mjs";
import { createNativeAlliance, createPlatformMaintainerSession, getE2eSql, closeE2eSql } from "../../../../e2e/fixtures/db";
import { getDb, getSqlClient, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { deleteObject, putObject } from "@/lib/storage";
import { ocrCaseFixture } from "@/test/ocr-corpus";
import { confirmCasePair, createCandidateCase, freezeDataset, reviseCaseLabels, revokeLearningCase } from "./corpus.server";
import { disabledWorkerPolicy } from "./control.shared";
import { loadWorkerPolicy, saveWorkerPolicy } from "./control-policy.server";
import { cancelWorkerJob, createWorkerJob, loadWorkerJob } from "./control-jobs.server";
import { claimWorkerJob, heartbeatWorkerJob } from "./control-leases.server";
import { completeWorkerJob } from "./control-results.server";
import { workerFrameAsset } from "./control-read.server";
import type { WorkerInference, WorkerInferenceResult } from "./worker.shared";

const keys: string[] = [];
let usedDatabase = false;

async function setup() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== process.env.E2E_DATABASE_URL?.trim() || process.env.R2_BUCKET) throw new Error("test_storage_mismatch");
  usedDatabase = true;
  const sql = getE2eSql();
  const user = await createPlatformMaintainerSession(sql);
  const { allianceId } = await createNativeAlliance(sql, { tag: `WC${nanoid(4)}`, name: "Worker control fixture", ownerHqUserId: user.hqUserId });
  const actor = { hqUserId: user.hqUserId, sessionId: user.sessionId };
  const workerCodeHash = createHash("sha256").update(nanoid()).digest("hex");
  const id = nanoid(), jobId = nanoid();
  await getDb().insert(schema.videoJobs).values({ id: jobId, sessionId: user.sessionId, allianceId, scoreTarget: "vs-performance", status: "complete" });
  const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#abcdef" } }).png().toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = `ocr-learning/${allianceId}/${id}/frame.png`;
  keys.push(key);
  await putObject(key, bytes);
  const sample = ocrCaseFixture(id, { allianceId, sourceSha256: sha256, lineageHashes: [sha256], sourceKind: "extracted_frame", durationSeconds: null, expiresAt: new Date(Date.now() + 86400000).toISOString(), state: "candidate", pairing: "unmatched", jobId: null, privacyReviewed: false, labelRevision: 0 });
  sample.frames = [{ sha256, storageKey: key, timestampSeconds: null, width: 100, height: 100 }];
  sample.labels[0].evidence[0] = { ...sample.labels[0].evidence[0], frameSha256: sha256, timestampSeconds: null };
  sample.labels[0].readableIntervals = [];
  await createCandidateCase({ sample, sourceStorageKey: key, sourceBytes: bytes.length, fileName: "source.png" }, actor);
  await confirmCasePair({ allianceId, caseId: id, jobId, expectedRevision: 0, confirmed: true }, actor);
  const verified = await reviseCaseLabels({ allianceId, caseId: id, expectedRevision: 1, labels: sample.labels, verify: true, privacyReviewed: true, externalTrainingAllowed: false }, actor);
  const dataset = await freezeDataset({ allianceId, cases: [{ id, revision: verified.labelRevision, split: "test" }] }, actor);
  const request = { allianceId, datasetId: dataset.id, caseId: id, scoreTarget: "vs-performance" as const, kind: "evaluate" as const, requestId: nanoid(), confirmed: true as const, sampler: { mode: "all" as const, minShiftFraction: 0.12, maxGapSeconds: 1.5, maxSelectedFrames: 100 } };
  const policy = { ...disabledWorkerPolicy, enabled: true, trustedWorkerCodeHash: workerCodeHash };
  return { actor, allianceId, workerCodeHash, sample: verified, dataset, request, policy };
}

function inferenceResult(f: Awaited<ReturnType<typeof setup>>, input: WorkerInference): WorkerInferenceResult {
  const label = f.sample.labels[0];
  return { workerCodeHash: f.workerCodeHash, samplingBudgetLimited: false, samplerFeatures: [], observations: [], prediction: {
    version: 1, caseId: f.sample.id, scoreTarget: f.sample.scoreTarget, sourceSha256: f.sample.sourceSha256,
    pipelineVersion: input.pipelineVersion, engine: "paddleocr", synthetic: false, selectedTimestamps: [], totalMs: 10, requests: 1, peakMemoryBytes: 100,
    rows: [{ name: label.name, score: label.score, memberId: label.memberId, confidence: 0.99, evidence: label.evidence }],
  } };
}

describe.skipIf(process.env.OCR_LEARNING_DB_TEST !== "1")("durable worker control plane", () => {
  afterAll(async () => {
    await Promise.all(keys.map((key) => deleteObject(key)));
    await closeE2eSql();
    if (usedDatabase) await getSqlClient().end({ timeout: 5 });
  });

  it("starts disabled, reserves requests idempotently and only admits the approved worker build", async () => {
    const f = await setup();
    expect((await loadWorkerPolicy(f.allianceId)).policy.enabled).toBe(false);
    await expect(createWorkerJob(f.request, f.actor)).rejects.toMatchObject({ code: "worker_disabled" });
    await saveWorkerPolicy(f.allianceId, 0, f.policy, f.actor);
    const [a, b] = await Promise.all([createWorkerJob(f.request, f.actor), createWorkerJob(f.request, f.actor)]);
    expect(a.id).toBe(b.id);
    expect(await claimWorkerJob(createHash("sha256").update(nanoid()).digest("hex"))).toBeNull();
    const claimed = await claimWorkerJob(f.workerCodeHash);
    expect(claimed?.id).toBe(a.id);
    expect(JSON.stringify(claimed?.input)).not.toContain("Álpha");
    expect(claimed?.input).not.toHaveProperty("labels");
    expect(await claimWorkerJob(f.workerCodeHash)).toBeNull();
    await cancelWorkerJob(f.allianceId, a.id, f.actor);
    await expect(heartbeatWorkerJob(a.id, claimed!.leaseToken)).rejects.toMatchObject({ code: "stale_worker_lease" });
  });

  it("grades an attributable result atomically without activating a production model", async () => {
    const f = await setup();
    await saveWorkerPolicy(f.allianceId, 0, f.policy, f.actor);
    const job = await createWorkerJob(f.request, f.actor);
    const lease = (await claimWorkerJob(f.workerCodeHash))!;
    const result = inferenceResult(f, lease.input as WorkerInference);
    expect((await workerFrameAsset(job.id, lease.leaseToken, f.sample.frames[0].sha256)).caseId).toBe(f.sample.id);
    const [a, b] = await Promise.all([completeWorkerJob(job.id, lease.leaseToken, result), completeWorkerJob(job.id, lease.leaseToken, result)]);
    expect(a.pipelineId).toBe(b.pipelineId);
    const stored = await loadWorkerJob(f.allianceId, job.id);
    expect(stored.state).toBe("ready");
    expect(stored.metrics).toMatchObject({ exactRows: 1 });
    const [model] = await getDb().select().from(schema.ocrModelVersions).where(eq(schema.ocrModelVersions.id, a.pipelineId!));
    expect(model.state).toBe("candidate");
    await expect(workerFrameAsset(job.id, lease.leaseToken, f.sample.frames[0].sha256)).rejects.toMatchObject({ code: "stale_worker_lease" });
    await expect(completeWorkerJob(job.id, "wrong", result)).rejects.toMatchObject({ code: "worker_result_conflict" });
    await expect(completeWorkerJob(job.id, lease.leaseToken, { ...result, prediction: { ...result.prediction, totalMs: 20 } })).rejects.toMatchObject({ code: "worker_result_conflict" });
  });

  it.each(["selection", "features"])("rejects %s timing that is not in the leased frame pool", async (claim) => {
    const f = await setup();
    await saveWorkerPolicy(f.allianceId, 0, f.policy, f.actor);
    const job = await createWorkerJob(f.request, f.actor);
    const lease = (await claimWorkerJob(f.workerCodeHash))!;
    const result = inferenceResult(f, lease.input as WorkerInference);
    if (claim === "selection") result.prediction.selectedTimestamps = [0];
    else result.samplerFeatures = [{ sha256: f.sample.frames[0].sha256, timestampSeconds: 0, sharpness: 1, verticalMotion: 0, motionConfidence: 1, sceneChange: false }];
    await expect(completeWorkerJob(job.id, lease.leaseToken, result)).rejects.toMatchObject({ code: "invalid_prediction_evidence" });
    expect(await loadWorkerJob(f.allianceId, job.id)).toMatchObject({ state: "running", result: null, metrics: null });
    await cancelWorkerJob(f.allianceId, job.id, f.actor);
  });

  it("rechecks live dataset revocation before heartbeat, asset access or completion", async () => {
    const f = await setup();
    await saveWorkerPolicy(f.allianceId, 0, f.policy, f.actor);
    const job = await createWorkerJob(f.request, f.actor);
    const lease = (await claimWorkerJob(f.workerCodeHash))!;
    const result = inferenceResult(f, lease.input as WorkerInference);
    await revokeLearningCase(f.allianceId, f.sample.id, f.sample.labelRevision, f.actor);
    await expect(heartbeatWorkerJob(job.id, lease.leaseToken)).rejects.toMatchObject({ code: "revoked_case" });
    await expect(workerFrameAsset(job.id, lease.leaseToken, f.sample.frames[0].sha256)).rejects.toMatchObject({ code: "revoked_case" });
    await expect(completeWorkerJob(job.id, lease.leaseToken, result)).rejects.toMatchObject({ code: "revoked_case" });
    expect(await loadWorkerJob(f.allianceId, job.id)).toMatchObject({ state: "running", result: null, metrics: null });
    await cancelWorkerJob(f.allianceId, job.id, f.actor);
  });

  it.each(["policy", "creator"])("rejects a running worker after its %s authority is revoked", async (change) => {
    const f = await setup();
    await saveWorkerPolicy(f.allianceId, 0, f.policy, f.actor);
    const job = await createWorkerJob(f.request, f.actor);
    const lease = (await claimWorkerJob(f.workerCodeHash))!;
    const result = inferenceResult(f, lease.input as WorkerInference);
    if (change === "policy") await saveWorkerPolicy(f.allianceId, 1, { ...f.policy, enabled: false }, f.actor);
    else await getDb().update(schema.hqUsers).set({ isPlatformMaintainer: 0 }).where(eq(schema.hqUsers.id, f.actor.hqUserId));
    await expect(heartbeatWorkerJob(job.id, lease.leaseToken)).rejects.toMatchObject({ code: "worker_policy_changed" });
    await expect(workerFrameAsset(job.id, lease.leaseToken, f.sample.frames[0].sha256)).rejects.toMatchObject({ code: "worker_policy_changed" });
    await expect(completeWorkerJob(job.id, lease.leaseToken, result)).rejects.toMatchObject({ code: "worker_policy_changed" });
    expect(await loadWorkerJob(f.allianceId, job.id)).toMatchObject({ state: "running", result: null, metrics: null });
    await cancelWorkerJob(f.allianceId, job.id, f.actor);
  });

  it("charges every uncertain retry and fences old lease tokens", async () => {
    const f = await setup();
    const policy = { ...f.policy, dailyReservedSeconds: 602, limits: { ...f.policy.limits, maxSeconds: 1 } };
    await saveWorkerPolicy(f.allianceId, 0, policy, f.actor);
    const job = await createWorkerJob(f.request, f.actor);
    const first = (await claimWorkerJob(f.workerCodeHash))!;
    const result = inferenceResult(f, first.input as WorkerInference);
    await getDb().update(schema.ocrWorkerJobs).set({ leaseExpiresAt: new Date(0) }).where(eq(schema.ocrWorkerJobs.id, job.id));
    const second = await claimWorkerJob(f.workerCodeHash);
    expect(second?.leaseToken).not.toBe(first.leaseToken);
    await expect(heartbeatWorkerJob(job.id, first.leaseToken)).rejects.toMatchObject({ code: "stale_worker_lease" });
    await expect(workerFrameAsset(job.id, first.leaseToken, f.sample.frames[0].sha256)).rejects.toMatchObject({ code: "stale_worker_lease" });
    await expect(completeWorkerJob(job.id, first.leaseToken, result)).rejects.toMatchObject({ code: "stale_worker_lease" });
    expect(await loadWorkerJob(f.allianceId, job.id)).toMatchObject({ state: "running", attempts: 2, result: null, metrics: null });
    expect((await loadWorkerPolicy(f.allianceId)).reservedSeconds).toBe(602);
    await getDb().update(schema.ocrWorkerJobs).set({ leaseExpiresAt: new Date(0) }).where(eq(schema.ocrWorkerJobs.id, job.id));
    expect(await claimWorkerJob(f.workerCodeHash)).toBeNull();
    const attempts = await getDb().select().from(schema.ocrWorkerAttempts).where(and(eq(schema.ocrWorkerAttempts.jobId, job.id), eq(schema.ocrWorkerAttempts.allianceId, f.allianceId)));
    expect(attempts).toHaveLength(2);
    await cancelWorkerJob(f.allianceId, job.id, f.actor);
  });

  it("stops a queued job when its creator loses maintainer authority", async () => {
    const f = await setup();
    await saveWorkerPolicy(f.allianceId, 0, f.policy, f.actor);
    const job = await createWorkerJob(f.request, f.actor);
    await getDb().update(schema.hqUsers).set({ isPlatformMaintainer: 0 }).where(eq(schema.hqUsers.id, f.actor.hqUserId));
    expect(await claimWorkerJob(f.workerCodeHash)).toBeNull();
    expect((await loadWorkerJob(f.allianceId, job.id)).state).toBe("failed");
  });
});
