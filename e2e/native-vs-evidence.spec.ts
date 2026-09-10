import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authCookieHeader, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { createNativeVsScenario, seedVsReviewJob } from "./fixtures/vs-evidence";
import { grantProcessorSlot, insertPendingVideoJob } from "./fixtures/video-processor";

const monday = "2026-08-31";

test("native VS submissions require score-write permission and stay tenant scoped", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeVsScenario(sql);
  const job = await seedVsReviewJob(sql, { allianceId: f.allianceId, actor: f.member, recordedDate: monday, rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 0 }] });
  const body = { recordedDate: monday, vsPeriod: "daily", rows: job.rows, requestId: randomUUID() };
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect([403, 404]).toContain((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { data: body })).status());
  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers: { Cookie: authCookieHeader(f.member) }, data: body })).status()).toBe(403);
  const editable = await seedVsReviewJob(sql, { allianceId: f.allianceId, actor: f.dataEntry, recordedDate: monday, rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 0 }] });
  expect((await request.post(`/api/tools/video-upload/${editable.jobId}/rematch-members`, { headers: { Cookie: authCookieHeader(f.dataEntry) } })).status()).toBe(200);
  const result = await request.post(`/api/tools/video-upload/${editable.jobId}/submit`, { headers: { Cookie: authCookieHeader(f.dataEntry) }, data: { ...body, rows: editable.rows, requestId: randomUUID() } });
  expect(result.status()).toBe(200);
  expect(await result.json()).toMatchObject({ storage: "hq", syncStatus: "local", submitted: 1 });
  expect((await sql`SELECT score FROM vs_score_heads WHERE alliance_id = ${f.allianceId}`)[0].score).toBe("0");
  const other = await createNativeVsScenario(sql);
  expect((await request.post(`/api/tools/video-upload/${editable.jobId}/submit`, { headers: { Cookie: authCookieHeader(other.owner) }, data: body })).status()).toBe(404);
  expect((await request.get("/api/internal/vs-scores/sync")).status()).toBe(403);
});

test("native VS processing preview and approval do not require Ashed", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeVsScenario(sql);
  await grantProcessorSlot(sql, { allianceId: f.allianceId, hqUserId: f.officer.hqUserId, grantedByHqUserId: f.owner.hqUserId });
  const jobId = await insertPendingVideoJob(sql, { allianceId: f.allianceId, sessionId: f.member.sessionId, enqueuedByHqUserId: f.member.hqUserId, scoreTarget: "vs-performance" });
  const headers = { Cookie: authCookieHeader(f.officer) };
  const preview = await request.get(`/api/tools/video-upload/${jobId}/process-preview`, { headers });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toMatchObject({ requiresAshedConnection: false, canProcess: true });
  expect((await request.post(`/api/tools/video-upload/${jobId}/approve`, { headers })).status()).toBe(200);
});

for (const locale of ["en-US", "pt-BR"] as const) {
  test(`native VS review saves locally with ${locale} copy and supports guarded batch maintenance`, async ({ page, request }) => {
    const sql = getE2eSql();
    const f = await createNativeVsScenario(sql);
    const actors = [f.owner, f.officer, f.otherOfficer, f.dataEntry, f.member];
    const job = await seedVsReviewJob(sql, { allianceId: f.allianceId, actor: f.officer, recordedDate: monday, rows: actors.map((actor, index) => ({ memberId: actor.memberId, memberName: actor.memberName, score: 10_000_000 - index * 1_000_000 })) });
    await page.context().addCookies(playwrightAuthCookies(f.officer));
    await page.goto(`/${locale}/tools/video-upload/${job.jobId}/review`);
    const save = page.getByRole("button", { name: locale === "en-US" ? "Save 5 scores" : "Salvar 5 pontuações", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(locale === "en-US" ? "Saved 5 VS scores in Alliance HQ." : "5 pontuações de VS salvas no Alliance HQ.", { exact: true })).toBeVisible();
    const [batch] = await sql`SELECT id FROM data_upload_batches WHERE source_job_id = ${job.jobId} AND status = 'active'`;
    const own = { Cookie: authCookieHeader(f.officer) };
    const scores = await request.get(`/api/data-management/batches/${batch.id}/scores`, { headers: own });
    expect(scores.status()).toBe(200);
    expect((await scores.json()).scores).toHaveLength(5);
    expect((await request.post(`/api/data-management/batches/${batch.id}/delete`, { headers: { Cookie: authCookieHeader(f.otherOfficer) } })).status()).toBe(403);
    expect((await request.post(`/api/data-management/batches/${batch.id}/move`, { headers: own, data: { newRecordedDate: "2026-09-06" } })).status()).toBe(400);
    expect((await request.post(`/api/data-management/batches/${batch.id}/move`, { headers: own, data: { newRecordedDate: "2026-09-01" } })).status()).toBe(200);
    expect((await sql`SELECT score FROM vs_score_heads WHERE alliance_id = ${f.allianceId} AND recorded_date = ${monday}`).every((row) => row.score == null)).toBe(true);
    const [moved] = await sql`SELECT id FROM data_upload_batches WHERE source_job_id = ${job.jobId} AND status = 'active'`;
    expect((await request.post(`/api/data-management/batches/${moved.id}/delete`, { headers: own })).status()).toBe(200);
    expect((await sql`SELECT score FROM vs_score_heads WHERE alliance_id = ${f.allianceId}`).every((row) => row.score == null)).toBe(true);
  });
}
