import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";
import { authCookieHeader, createAuthenticatedHqSession, createNativeAlliance, createPlatformMaintainerSession, getE2eSql } from "./fixtures/db";
import { ocrCaseFixture } from "../src/test/ocr-corpus";
import { stableJson } from "../src/lib/ocr/benchmark/json.shared";

const base = "/api/admin/ocr-learning";

test("OCR learning denies bootstrap and authenticated non-maintainer sessions", async ({ request }) => {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  const cookie = bootstrap.headers()["set-cookie"].match(/alliance_hq_session=([^;]+)/)?.[0];
  expect(cookie).toBeTruthy();
  const headers = { Cookie: cookie! };
  expect((await request.get(`${base}/cases?allianceId=unknown`, { headers })).status()).toBe(403);
  expect((await request.post(`${base}/datasets`, { headers, data: {} })).status()).toBe(403);
  expect((await request.patch(`${base}/cases/unknown?allianceId=unknown`, { headers, data: { action: "revoke", confirmed: true, expectedRevision: 0 } })).status()).toBe(403);
  const user = await createAuthenticatedHqSession(getE2eSql(), `ocr-member-${nanoid(8)}@e2e.test`);
  expect((await request.get(`${base}/cases?allianceId=unknown`, { headers: { Cookie: authCookieHeader(user) } })).status()).toBe(403);
});

for (const scoreTarget of ["vs-performance", "alliance-kills-video"] as const) {
  test(`${scoreTarget} pairing and dataset lifecycle stay private and do not submit scores`, async ({ request }) => {
    const sql = getE2eSql();
    const user = await createPlatformMaintainerSession(sql);
    const { allianceId } = await createNativeAlliance(sql, { tag: `OCR${nanoid(5)}`, name: "OCR fixture", ownerHqUserId: user.hqUserId });
    const headers = { Cookie: authCookieHeader(user) };
    const jobId = nanoid(), id = nanoid();
    const sample = ocrCaseFixture(id, { allianceId, scoreTarget, pairing: "unmatched", jobId: null, state: "candidate", labelRevision: 0, privacyReviewed: false, expiresAt: new Date(Date.now() + 86400000).toISOString() });
    if (scoreTarget === "alliance-kills-video") delete sample.context.vsPeriod;
    const hash = createHash("sha256").update(stableJson(sample)).digest("hex");
    await sql`INSERT INTO video_jobs (id, session_id, alliance_id, score_target, status) VALUES (${jobId}, ${user.sessionId}, ${allianceId}, ${scoreTarget}, 'complete')`;
    await sql`INSERT INTO ocr_learning_cases (id, alliance_id, score_target, source_storage_key, source_sha256, source_bytes, file_name, recording_group_id, snapshot, snapshot_hash, expires_at) VALUES (${id}, ${allianceId}, ${scoreTarget}, ${`ocr-learning/${allianceId}/${id}/source.mp4`}, ${sample.sourceSha256}, 1000, 'source.mp4', ${id}, ${sql.json(sample)}, ${hash}, ${new Date(sample.expiresAt)})`;
    const list = await request.get(`${base}/cases?allianceId=${allianceId}`, { headers });
    expect(list.status(), await list.text()).toBe(200);
    expect(list.headers()["cache-control"]).toContain("no-store");
    expect((await list.json()).cases).toHaveLength(1);
    expect((await request.get(`${base}/cases/${id}?allianceId=foreign`, { headers })).status()).toBe(404);
    const premature = await request.post(`${base}/datasets`, { headers, data: { allianceId, cases: [{ id, revision: 0, split: "test" }] } });
    expect(premature.status()).toBe(400);
    const pair = await request.patch(`${base}/cases/${id}?allianceId=${allianceId}`, { headers, data: { action: "pair", expectedRevision: 0, jobId, confirmed: true } });
    expect(pair.status(), await pair.text()).toBe(200);
    const labels = await request.patch(`${base}/cases/${id}?allianceId=${allianceId}`, { headers, data: { action: "labels", expectedRevision: 1, labels: sample.labels, verify: true, privacyReviewed: true, externalTrainingAllowed: false } });
    expect(labels.status(), await labels.text()).toBe(200);
    const created = await request.post(`${base}/datasets`, { headers, data: { allianceId, cases: [{ id, revision: 2, split: "test" }] } });
    expect(created.status(), await created.text()).toBe(201);
    const dataset = await created.json();
    expect((await request.get(`${base}/datasets/${dataset.id}?allianceId=${allianceId}`, { headers })).status()).toBe(200);
    expect((await request.get(`${base}/datasets/${dataset.id}?allianceId=foreign`, { headers })).status()).toBe(404);
    expect((await sql`SELECT status FROM video_jobs WHERE id = ${jobId}`)[0].status).toBe("complete");
    expect(await sql`SELECT id FROM data_upload_batches WHERE source_job_id = ${jobId}`).toHaveLength(0);
    const revoked = await request.patch(`${base}/cases/${id}?allianceId=${allianceId}`, { headers, data: { action: "revoke", expectedRevision: 2, confirmed: true } });
    expect(revoked.status()).toBe(200);
    const unavailable = await request.get(`${base}/datasets/${dataset.id}?allianceId=${allianceId}`, { headers });
    expect(unavailable.status()).toBe(409);
    expect(await unavailable.json()).toMatchObject({ code: "revoked_case" });
  });
}
