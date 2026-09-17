import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { authCookieHeader, createAuthenticatedHqSession, createNativeAlliance, createPlatformMaintainerSession, getE2eSql } from "./fixtures/db";

const base = "/api/admin/ocr-learning";

test("media policy, upload, retention and pixels reject non-maintainers", async ({ request }) => {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  const cookie = bootstrap.headers()["set-cookie"].match(/alliance_hq_session=([^;]+)/)?.[0];
  expect(cookie).toBeTruthy();
  const user = await createAuthenticatedHqSession(getE2eSql(), `media-member-${nanoid(8)}@e2e.test`);
  for (const Cookie of [cookie!, authCookieHeader(user)]) {
    const headers = { Cookie };
    expect((await request.get(`${base}/media-policy?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.patch(`${base}/media-policy?allianceId=unknown`, { headers, data: {} })).status()).toBe(403);
    expect((await request.get(`${base}/imports?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.post(`${base}/imports`, { headers, data: {} })).status()).toBe(403);
    expect((await request.get(`${base}/imports/unknown?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.put(`${base}/imports/unknown/upload?allianceId=unknown`, { headers, data: Buffer.from("fixture") })).status()).toBe(403);
    expect((await request.post(`${base}/imports/unknown/complete?allianceId=unknown`, { headers, data: {} })).status()).toBe(403);
    expect((await request.get(`${base}/cases/unknown/media?allianceId=unknown`, { headers })).status()).toBe(403);
    expect((await request.post(`${base}/retention?allianceId=unknown`, { headers, data: { confirmed: true } })).status()).toBe(403);
  }
  expect((await request.post("/api/internal/video-process/ocr-media/unknown", { data: {} })).status()).toBe(403);
});

for (const scoreTarget of ["vs-performance", "alliance-kills-video"] as const) {
  test(`${scoreTarget} seals real pixels with explicit permission and bounded retention`, async ({ request }) => {
    const sql = getE2eSql();
    const user = await createPlatformMaintainerSession(sql);
    const { allianceId } = await createNativeAlliance(sql, { tag: `MI${nanoid(5)}`, name: "Media import fixture" });
    const headers = { Cookie: authCookieHeader(user) };
    const bytes = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#abcdef" } }).png().toBuffer();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const input = { allianceId, scoreTarget, requestId: nanoid(), fileName: "fixture.png", contentType: "image/png", bytes: bytes.length, sha256 };
    const disabled = await request.post(`${base}/imports`, { headers, data: input });
    expect(disabled.status()).toBe(409);
    const policy = { enabled: true, dataPermissionApproved: true, sourceLimitBytes: 1_000_000, storageBudgetBytes: 2_000_000, retentionDays: 1, maxFrames: 4 };
    const configured = await request.patch(`${base}/media-policy?allianceId=${allianceId}`, { headers, data: { expectedRevision: 0, policy } });
    expect(configured.status(), await configured.text()).toBe(200);
    const created = await request.post(`${base}/imports`, { headers, data: input });
    expect(created.status(), await created.text()).toBe(201);
    const task = await created.json();
    const uploaded = await request.put(task.upload.url, { headers: { ...headers, "Content-Type": "image/png" }, data: bytes });
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    const queued = await request.post(`${base}/imports/${task.id}/complete?allianceId=${allianceId}`, { headers, data: {} });
    expect(queued.status(), await queued.text()).toBe(202);
    await expect.poll(async () => (await (await request.get(`${base}/imports/${task.id}?allianceId=${allianceId}`, { headers })).json()).state, { timeout: 20000 }).toBe("ready");
    const detail = await request.get(`${base}/cases/${task.id}?allianceId=${allianceId}`, { headers });
    expect(detail.status()).toBe(200);
    const { sample } = await detail.json();
    expect(sample).toMatchObject({ state: "candidate", pairing: "unmatched", privacyReviewed: false, externalTrainingAllowed: false });
    const source = await request.get(`${base}/cases/${task.id}/media?allianceId=${allianceId}`, { headers });
    expect(source.status()).toBe(200);
    expect(await source.body()).toEqual(bytes);
    expect(source.headers()["cache-control"]).toContain("no-store");
    const range = await request.get(`${base}/cases/${task.id}/media?allianceId=${allianceId}`, { headers: { ...headers, Range: "bytes=0-7" } });
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(bytes.subarray(0, 8));
    const frame = await request.get(`${base}/cases/${task.id}/media?allianceId=${allianceId}&frame=${sample.frames[0].sha256}`, { headers });
    expect(frame.status()).toBe(200);
    expect(createHash("sha256").update(await frame.body()).digest("hex")).toBe(sample.frames[0].sha256);
    expect((await request.get(`${base}/cases/${task.id}/media?allianceId=foreign`, { headers })).status()).toBe(404);
    const [stored] = await sql`SELECT staging_key FROM ocr_media_tasks WHERE id = ${task.id}`;
    expect(stored.staging_key.startsWith(`ocr-staging/${allianceId}/${task.id}/`)).toBe(true);
    await unlink(path.join(process.cwd(), ".data", "uploads", stored.staging_key));
    expect(await (await request.get(`${base}/cases/${task.id}/media?allianceId=${allianceId}`, { headers })).body()).toEqual(bytes);
    expect((await request.post(`${base}/retention?allianceId=${allianceId}`, { headers, data: { confirmed: false } })).status()).toBe(400);
    expect(await (await request.post(`${base}/retention?allianceId=${allianceId}`, { headers, data: { confirmed: true } })).json()).toMatchObject({ deleted: 0 });
    await request.patch(`${base}/cases/${task.id}?allianceId=${allianceId}`, { headers, data: { action: "revoke", expectedRevision: 0, confirmed: true } });
    expect((await request.get(`${base}/cases/${task.id}/media?allianceId=${allianceId}`, { headers })).status()).toBe(410);
    await sql`UPDATE ocr_media_tasks SET expires_at = '2000-01-01' WHERE id = ${task.id}`;
    await sql`UPDATE ocr_media_objects SET delete_after = '2000-01-01' WHERE task_id = ${task.id}`;
    const cleanup = await request.post(`${base}/retention?allianceId=${allianceId}`, { headers, data: { confirmed: true } });
    expect(cleanup.status(), await cleanup.text()).toBe(200);
    expect((await cleanup.json()).deleted).toBeGreaterThan(0);
    expect((await (await request.get(`${base}/media-policy?allianceId=${allianceId}`, { headers })).json()).reservedBytes).toBe(0);
  });
}
