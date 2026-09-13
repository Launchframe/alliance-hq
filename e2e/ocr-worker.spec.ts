import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authCookieHeader, createAuthenticatedHqSession, createNativeAlliance, createPlatformMaintainerSession, getE2eSql } from "./fixtures/db";

const admin = "/api/admin/ocr-learning";
const internal = "/api/internal/ocr-worker";
const workerSecret = "e2e-ocr-worker-secret-not-for-production";
const workerAuth = { Authorization: `Bearer ${workerSecret}` };
const limits = { maxSeconds: 300, maxMemoryBytes: 4 * 1024 ** 3, maxFrames: 1000, maxInputBytes: 512 * 1024 ** 2, maxWorkBytes: 4 * 1024 ** 3, maxOutputBytes: 256 * 1024 ** 2 };

type Fixture = { user: Awaited<ReturnType<typeof createPlatformMaintainerSession>>; allianceId: string; headers: { Cookie: string } };

async function setup(request: APIRequestContext, workerCodeHash: string): Promise<Fixture> {
  const sql = getE2eSql();
  const user = await createPlatformMaintainerSession(sql);
  const { allianceId } = await createNativeAlliance(sql, { tag: `WB${nanoid(5)}`, name: "Worker broker fixture", ownerHqUserId: user.hqUserId });
  const headers = { Cookie: authCookieHeader(user) };
  const media = await request.patch(`${admin}/media-policy?allianceId=${allianceId}`, { headers, data: { expectedRevision: 0, policy: { enabled: true, dataPermissionApproved: true, sourceLimitBytes: 1_000_000, storageBudgetBytes: 20_000_000, retentionDays: 1, maxFrames: 4 } } });
  expect(media.status(), await media.text()).toBe(200);
  const policy = await request.patch(`${admin}/worker-policy?allianceId=${allianceId}`, { headers, data: { expectedRevision: 0, policy: { enabled: true, trustedWorkerCodeHash: workerCodeHash, dailyReservedSeconds: 3600, modelStorageBytes: 2 * 1024 ** 3, retentionDays: 1, rosterScope: "none", limits } } });
  expect(policy.status(), await policy.text()).toBe(200);
  return { user, allianceId, headers };
}

async function example(request: APIRequestContext, f: Fixture, name: string, score: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="220"><rect width="1000" height="220" fill="white"/><g font-family="sans-serif" font-size="48" fill="black"><text x="40" y="115">${name}</text><text x="550" y="115">${score}</text></g></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const created = await request.post(`${admin}/imports`, { headers: f.headers, data: { allianceId: f.allianceId, scoreTarget: "vs-performance", requestId: nanoid(), fileName: "fixture.png", contentType: "image/png", bytes: bytes.length, sha256 } });
  expect(created.status(), await created.text()).toBe(201);
  const imported = await created.json();
  expect((await request.put(imported.upload.url, { headers: { ...f.headers, "Content-Type": "image/png" }, data: bytes })).status()).toBe(200);
  expect((await request.post(`${admin}/imports/${imported.id}/complete?allianceId=${f.allianceId}`, { headers: f.headers, data: {} })).status()).toBe(202);
  await expect.poll(async () => (await (await request.get(`${admin}/imports/${imported.id}?allianceId=${f.allianceId}`, { headers: f.headers })).json()).state, { timeout: 20000 }).toBe("ready");
  const raw = await (await request.get(`${admin}/cases/${imported.id}?allianceId=${f.allianceId}`, { headers: f.headers })).json();
  const jobId = nanoid();
  await getE2eSql()`INSERT INTO video_jobs (id, session_id, alliance_id, score_target, status) VALUES (${jobId}, ${f.user.sessionId}, ${f.allianceId}, 'vs-performance', 'complete')`;
  expect((await request.patch(`${admin}/cases/${imported.id}?allianceId=${f.allianceId}`, { headers: f.headers, data: { action: "pair", jobId, expectedRevision: 0, confirmed: true } })).status()).toBe(200);
  const labels = [{ id: nanoid(), name, score, memberId: null, rank: null, readable: true, readableIntervals: [], evidence: [{ frameSha256: raw.sample.frames[0].sha256, timestampSeconds: null, box: [0.02, 0.2, 0.88, 0.7], nameBox: [0.03, 0.25, 0.3, 0.65], scoreBox: [0.54, 0.25, 0.86, 0.65] }] }];
  const verified = await request.patch(`${admin}/cases/${imported.id}?allianceId=${f.allianceId}`, { headers: f.headers, data: { action: "labels", expectedRevision: 1, labels, verify: true, privacyReviewed: true, externalTrainingAllowed: false } });
  expect(verified.status(), await verified.text()).toBe(200);
  return (await verified.json()).sample;
}

async function freeze(request: APIRequestContext, f: Fixture, cases: Array<{ id: string; revision: number; split: "train" | "validation" | "test" }>) {
  const result = await request.post(`${admin}/datasets`, { headers: f.headers, data: { allianceId: f.allianceId, cases } });
  expect(result.status(), await result.text()).toBe(201);
  return (await result.json()).id as string;
}

test("worker policy, jobs, models and internal capabilities reject browser-only authority", async ({ request }) => {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  const cookie = bootstrap.headers()["set-cookie"].match(/alliance_hq_session=([^;]+)/)?.[0];
  expect(cookie).toBeTruthy();
  const member = await createAuthenticatedHqSession(getE2eSql(), `worker-member-${nanoid(8)}@e2e.test`);
  for (const Cookie of [cookie!, authCookieHeader(member)]) {
    const headers = { Cookie };
    expect((await request.get(`${admin}/worker-policy?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.patch(`${admin}/worker-policy?allianceId=unknown`, { headers, data: {} })).status()).toBe(403);
    expect((await request.get(`${admin}/worker-jobs?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.post(`${admin}/worker-jobs`, { headers, data: {} })).status()).toBe(403);
    expect((await request.get(`${admin}/worker-jobs/unknown?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.delete(`${admin}/worker-jobs/unknown?allianceId=unknown`, { headers, data: { confirmed: true } })).status()).toBe(403);
    expect((await request.get(`${admin}/models?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.delete(`${admin}/models/unknown?allianceId=unknown`, { headers, data: { confirmed: true } })).status()).toBe(403);
    expect((await request.post(`${admin}/worker-retention?allianceId=unknown`, { headers, data: { confirmed: true } })).status()).toBe(403);
    for (const suffix of ["heartbeat", "complete", "fail", "artifacts"]) expect((await request.post(`${internal}/jobs/unknown/${suffix}`, { headers, data: {} })).status()).toBe(403);
    expect((await request.post(`${internal}/claim`, { headers, data: {} })).status()).toBe(403);
    expect((await request.get(`${internal}/jobs/unknown/assets/${"a".repeat(64)}`, { headers })).status()).toBe(403);
    expect((await request.get(`${internal}/jobs/unknown/model`, { headers })).status()).toBe(403);
    expect((await request.get(`${internal}/jobs/unknown/model/data`, { headers })).status()).toBe(403);
    expect((await request.put(`${internal}/artifacts/unknown`, { headers, data: Buffer.from("fixture") })).status()).toBe(403);
  }
});

test("worker protocol binds jobs and pixels, grades privately and honors live revocation", async ({ request }) => {
  const workerCodeHash = createHash("sha256").update(nanoid()).digest("hex");
  const f = await setup(request, workerCodeHash);
  const sample = await example(request, f, "ALPHA", "1234567");
  const datasetId = await freeze(request, f, [{ id: sample.id, revision: sample.labelRevision, split: "test" }]);
  const created = await request.post(`${admin}/worker-jobs`, { headers: f.headers, data: { allianceId: f.allianceId, datasetId, caseId: sample.id, scoreTarget: "vs-performance", kind: "evaluate", requestId: nanoid(), confirmed: true } });
  expect(created.status(), await created.text()).toBe(202);
  const job = await created.json();
  const claim = await request.post(`${internal}/claim`, { headers: workerAuth, data: { workerCodeHash } });
  expect(claim.status(), await claim.text()).toBe(200);
  const lease = (await claim.json()).job;
  expect(lease.id).toBe(job.id);
  expect(JSON.stringify(lease.input)).not.toContain("ALPHA");
  expect(lease.input).not.toHaveProperty("labels");
  const headers = { ...workerAuth, "X-Ocr-Lease": lease.leaseToken };
  expect((await request.get(`${internal}/jobs/${job.id}/assets/${sample.frames[0].sha256}`, { headers })).status()).toBe(200);
  expect((await request.get(`${internal}/jobs/${job.id}/assets/${sample.frames[0].sha256}`, { headers: { ...workerAuth, "X-Ocr-Lease": "wrong" } })).status()).toBe(409);
  expect((await request.get(`${admin}/worker-jobs/${job.id}?allianceId=foreign`, { headers: f.headers })).status()).toBe(404);
  const prediction = { version: 1, caseId: sample.id, scoreTarget: sample.scoreTarget, sourceSha256: sample.sourceSha256, pipelineVersion: lease.input.pipelineVersion, engine: "paddleocr", synthetic: false, selectedTimestamps: [], totalMs: 10, requests: 1, peakMemoryBytes: 100, rows: [{ name: "ALPHA", score: "1234567", memberId: null, confidence: 0.99, evidence: sample.labels[0].evidence }] };
  const output = { prediction, workerCodeHash, samplingBudgetLimited: false, samplerFeatures: [], observations: [] };
  for (const invalid of [
    { ...output, prediction: { ...prediction, selectedTimestamps: [0] } },
    { ...output, samplerFeatures: [{ sha256: sample.frames[0].sha256, timestampSeconds: 0, sharpness: 1, verticalMotion: 0, motionConfidence: 1, sceneChange: false }] },
  ]) {
    const rejected = await request.post(`${internal}/jobs/${job.id}/complete`, { headers, data: { output: invalid } });
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "invalid_prediction_evidence" });
  }
  expect((await request.post(`${internal}/jobs/${job.id}/complete`, { headers, data: { output } })).status()).toBe(200);
  expect((await request.post(`${internal}/jobs/${job.id}/complete`, { headers, data: { output } })).status()).toBe(200);
  expect((await request.post(`${internal}/jobs/${job.id}/complete`, { headers: { ...workerAuth, "X-Ocr-Lease": "wrong" }, data: { output } })).status()).toBe(409);
  const finished = await (await request.get(`${admin}/worker-jobs/${job.id}?allianceId=${f.allianceId}`, { headers: f.headers })).json();
  expect(finished.metrics.exactRows).toBe(1);
  expect((await (await request.get(`${admin}/models?allianceId=${f.allianceId}`, { headers: f.headers })).json()).models[0].state).toBe("candidate");
  const again = await request.post(`${admin}/worker-jobs`, { headers: f.headers, data: { allianceId: f.allianceId, datasetId, caseId: sample.id, scoreTarget: "vs-performance", kind: "evaluate", requestId: nanoid(), confirmed: true } });
  const second = await again.json();
  const next = (await (await request.post(`${internal}/claim`, { headers: workerAuth, data: { workerCodeHash } })).json()).job;
  expect(next.id).toBe(second.id);
  expect((await request.patch(`${admin}/cases/${sample.id}?allianceId=${f.allianceId}`, { headers: f.headers, data: { action: "revoke", expectedRevision: sample.labelRevision, confirmed: true } })).status()).toBe(200);
  const nextHeaders = { ...workerAuth, "X-Ocr-Lease": next.leaseToken };
  expect((await request.post(`${internal}/jobs/${second.id}/heartbeat`, { headers: nextHeaders, data: {} })).status()).toBe(409);
  expect((await request.get(`${internal}/jobs/${second.id}/assets/${sample.frames[0].sha256}`, { headers: nextHeaders })).status()).toBe(409);
  const revoked = await request.post(`${internal}/jobs/${second.id}/complete`, { headers: nextHeaders, data: { output } });
  expect(revoked.status()).toBe(409);
  expect(await revoked.json()).toMatchObject({ code: "revoked_case" });
  expect(await (await request.get(`${admin}/worker-jobs/${second.id}?allianceId=${f.allianceId}`, { headers: f.headers })).json()).toMatchObject({ state: "running", result: null, metrics: null });
  expect((await request.delete(`${admin}/worker-jobs/${second.id}?allianceId=${f.allianceId}`, { headers: f.headers, data: { confirmed: true } })).status()).toBe(200);
});

test("real pull worker trains, seals a model and evaluates held-out pixels through the broker", async ({ request }, testInfo) => {
  test.skip(!process.env.OCR_WORKER_PYTHON || !process.env.OCR_WORKER_MODELS, "requires verified local Paddle worker artifacts");
  test.setTimeout(240000);
  const directory = await mkdtemp(path.join(os.tmpdir(), "ocr-broker-worker-"));
  try {
    const python = process.env.OCR_WORKER_PYTHON!;
    const cwd = path.resolve("workers/ocr");
    const execute = promisify(execFile);
    const environment = { PATH: process.env.PATH, HOME: directory, NODE_ENV: "test" as const, OCR_WORKER_SECRET: workerSecret, PYTHONNOUSERSITE: "1" };
    const workerCodeHash = (await execute(python, ["-m", "ocr_worker.build"], { cwd, env: environment })).stdout.trim();
    const f = await setup(request, workerCodeHash);
    const a = await example(request, f, "ALPHA", "1234567"), b = await example(request, f, "BETA", "7654321"), c = await example(request, f, "GAMMA", "3456789");
    const datasetId = await freeze(request, f, [{ id: a.id, revision: a.labelRevision, split: "train" }, { id: b.id, revision: b.labelRevision, split: "train" }, { id: c.id, revision: c.labelRevision, split: "validation" }]);
    const created = await request.post(`${admin}/worker-jobs`, { headers: f.headers, data: { allianceId: f.allianceId, datasetId, scoreTarget: "vs-performance", kind: "train", requestId: nanoid(), confirmed: true, recipe: { family: "paddle-v5-mobile-rec", epochs: 1, batchSize: 2, learningRate: 0.00001, seed: 7 } } });
    expect(created.status(), await created.text()).toBe(202);
    const job = await created.json();
    const run = (jobId: string) => execute(python, ["-m", "ocr_worker.client", "--base-url", testInfo.project.use.baseURL!, "--models", process.env.OCR_WORKER_MODELS!, "--source", path.join(cwd, ".runtime/paddleocr"), "--spool", directory, "--once", "--job-id", jobId], { cwd, env: environment, timeout: 180000 });
    await run(job.id);
    const trained = await (await request.get(`${admin}/worker-jobs/${job.id}?allianceId=${f.allianceId}`, { headers: f.headers })).json();
    expect(trained.state, JSON.stringify({ state: trained.state, code: trained.errorCode })).toBe("ready");
    expect(trained.result.manifest.updatedTensors).toBeGreaterThan(0);
    const registered = await (await request.get(`${admin}/models?allianceId=${f.allianceId}`, { headers: f.headers })).json();
    expect(registered.models).toEqual(expect.arrayContaining([expect.objectContaining({ id: trained.pipelineId, state: "candidate" })]));
    const heldOut = await example(request, f, "DELTA", "4567891");
    const heldOutId = await freeze(request, f, [{ id: heldOut.id, revision: heldOut.labelRevision, split: "test" }]);
    const evaluation = await request.post(`${admin}/worker-jobs`, { headers: f.headers, data: { allianceId: f.allianceId, datasetId: heldOutId, caseId: heldOut.id, scoreTarget: "vs-performance", kind: "evaluate", pipelineId: trained.pipelineId, requestId: nanoid(), confirmed: true } });
    expect(evaluation.status(), await evaluation.text()).toBe(202);
    const evaluatedId = (await evaluation.json()).id;
    await run(evaluatedId);
    const evaluated = await (await request.get(`${admin}/worker-jobs/${evaluatedId}?allianceId=${f.allianceId}`, { headers: f.headers })).json();
    expect(evaluated.state, JSON.stringify({ state: evaluated.state, code: evaluated.errorCode })).toBe("ready");
    expect(evaluated.metrics.exactRows).toBe(1);
    expect((await request.patch(`${admin}/cases/${a.id}?allianceId=${f.allianceId}`, { headers: f.headers, data: { action: "revoke", expectedRevision: a.labelRevision, confirmed: true } })).status()).toBe(200);
    expect((await request.post(`${admin}/worker-jobs`, { headers: f.headers, data: { allianceId: f.allianceId, datasetId: heldOutId, caseId: heldOut.id, scoreTarget: "vs-performance", kind: "evaluate", pipelineId: trained.pipelineId, requestId: nanoid(), confirmed: true } })).status()).toBe(409);
    expect((await request.post(`${admin}/worker-retention?allianceId=${f.allianceId}`, { headers: f.headers, data: { confirmed: false } })).status()).toBe(400);
    await getE2eSql()`UPDATE ocr_worker_artifacts SET expires_at = '2000-01-01', created_at = '2000-01-01' WHERE job_id = ${job.id}`;
    await getE2eSql()`UPDATE ocr_worker_jobs SET lease_expires_at = '2000-01-01' WHERE id = ${job.id}`;
    const cleanup = await request.post(`${admin}/worker-retention?allianceId=${f.allianceId}`, { headers: f.headers, data: { confirmed: true } });
    expect(cleanup.status(), await cleanup.text()).toBe(200);
    expect((await cleanup.json()).deleted).toBe(1);
    expect((await (await request.get(`${admin}/worker-policy?allianceId=${f.allianceId}`, { headers: f.headers })).json()).reservedBytes).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
