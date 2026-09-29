import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authCookieHeader, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { createNativeFrontlineScenario, createFrontlineEvent, seedFrontlineReviewJob } from "./fixtures/frontline";
import { grantProcessorSlot, insertPendingVideoJob } from "./fixtures/video-processor";

const recordedDate = "2026-08-31";

function submitBody(job: Awaited<ReturnType<typeof seedFrontlineReviewJob>>, hqEventId: string) {
  return {
    hqEventId,
    recordedDate,
    rows: job.rows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      score: row.score,
      rank: row.rank,
      frontlineStage: row.frontlineStage,
    })),
    requestId: randomUUID(),
  };
}

test("native Frontline submissions require score-write permission and stay tenant scoped", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const job = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.member,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 2670, frontlineStage: 5, rank: 3 }],
  });
  const body = submitBody(job, event.id);
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect([403, 404]).toContain((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { data: body })).status());
  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers: { Cookie: authCookieHeader(f.member) }, data: body })).status()).toBe(403);

  const editable = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.dataEntry,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 2670, frontlineStage: 5, rank: 3 }],
  });
  const result = await request.post(`/api/tools/video-upload/${editable.jobId}/submit`, {
    headers: { Cookie: authCookieHeader(f.dataEntry) },
    data: submitBody(editable, event.id),
  });
  expect(result.status()).toBe(200);
  expect(await result.json()).toMatchObject({ ok: true, storage: "hq", submitted: 1 });
  const [saved] = await sql`SELECT metadata FROM hq_event_members WHERE hq_event_id = ${event.id} AND member_id = ${f.member.memberId}`;
  expect(saved.metadata).toMatchObject({ score: 2670, frontlineStage: 5, rank: 3, sourceJobId: editable.jobId });

  const other = await createNativeFrontlineScenario(sql);
  expect((await request.post(`/api/tools/video-upload/${editable.jobId}/submit`, { headers: { Cookie: authCookieHeader(other.owner) }, data: body })).status()).toBe(404);
});

test("native Frontline submit rejects foreign rows, members, events, and wrong targets without writes", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const job = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.officer.memberId, memberName: f.officer.memberName, score: 900, frontlineStage: 4, rank: 8 }],
  });
  const headers = { Cookie: authCookieHeader(f.officer) };
  const before = await sql`SELECT count(*)::int AS count FROM hq_event_members WHERE hq_event_id = ${event.id}`;

  const foreign = await createNativeFrontlineScenario(sql);
  const foreignEvent = await createFrontlineEvent(sql, { allianceId: foreign.allianceId });

  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, {
    headers,
    data: { ...submitBody(job, foreignEvent.id), recordedDate },
  })).status()).toBe(400);

  const badMember = submitBody(job, event.id);
  badMember.rows[0]!.memberId = foreign.officer.memberId;
  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers, data: badMember })).status()).toBe(400);

  const badRow = submitBody(job, event.id);
  badRow.rows[0]!.id = "foreign-row";
  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers, data: badRow })).status()).toBe(400);

  const noStage = submitBody(job, event.id);
  (noStage.rows[0] as { frontlineStage?: number | null }).frontlineStage = null;
  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers, data: noStage })).status()).toBe(400);

  const after = await sql`SELECT count(*)::int AS count FROM hq_event_members WHERE hq_event_id = ${event.id}`;
  expect(after[0].count).toBe(before[0].count);
  expect((await sql`SELECT status FROM video_jobs WHERE id = ${job.jobId}`)[0].status).toBe("review");
});

test("native Frontline repeat saves stay stable and unseen members are preserved", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const job = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [
      { memberId: f.officer.memberId, memberName: f.officer.memberName, score: 100, frontlineStage: 5, rank: 1 },
      { memberId: f.member.memberId, memberName: f.member.memberName, score: 90, frontlineStage: 4, rank: 2 },
    ],
  });
  const headers = { Cookie: authCookieHeader(f.officer) };
  const body = submitBody(job, event.id);

  const first = await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers, data: body });
  expect(first.status()).toBe(200);
  const second = await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers, data: { ...body, requestId: randomUUID() } });
  expect(second.status()).toBe(200);
  const members = await sql`SELECT member_id FROM hq_event_members WHERE hq_event_id = ${event.id}`;
  expect(members).toHaveLength(2);

  const partial = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 95, frontlineStage: 4, rank: 2 }],
  });
  const partialBody = submitBody(partial, event.id);
  const resave = await request.post(`/api/tools/video-upload/${partial.jobId}/submit`, { headers, data: partialBody });
  expect(resave.status()).toBe(200);
  const after = await sql`SELECT member_id, metadata FROM hq_event_members WHERE hq_event_id = ${event.id}`;
  expect(after).toHaveLength(2);
  const officerRow = after.find((row) => row.member_id === f.officer.memberId);
  expect(officerRow.metadata).toMatchObject({ score: 100, frontlineStage: 5, sourceJobId: job.jobId });
});

test("native Frontline submit rejects wrong-target events and processor-only users", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const wrongTarget = await createFrontlineEvent(sql, { allianceId: f.allianceId, scoreTarget: "desert-storm" });
  const job = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.officer.memberId, memberName: f.officer.memberName, score: 900, frontlineStage: 4, rank: 8 }],
  });
  const headers = { Cookie: authCookieHeader(f.officer) };

  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, {
    headers,
    data: submitBody(job, wrongTarget.id),
  })).status()).toBe(400);

  await grantProcessorSlot(sql, { allianceId: f.allianceId, hqUserId: f.member.hqUserId, grantedByHqUserId: f.owner.hqUserId });
  expect((await request.post(`/api/tools/video-upload/${job.jobId}/submit`, {
    headers: { Cookie: authCookieHeader(f.member) },
    data: submitBody(job, event.id),
  })).status()).toBe(403);
  expect((await sql`SELECT status FROM video_jobs WHERE id = ${job.jobId}`)[0].status).toBe("review");
});

test("native Frontline processing preview and approval do not require Ashed", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  await grantProcessorSlot(sql, { allianceId: f.allianceId, hqUserId: f.officer.hqUserId, grantedByHqUserId: f.owner.hqUserId });
  const jobId = await insertPendingVideoJob(sql, { allianceId: f.allianceId, sessionId: f.member.sessionId, enqueuedByHqUserId: f.member.hqUserId, scoreTarget: "frontline-breakthrough" });
  const headers = { Cookie: authCookieHeader(f.officer) };
  const preview = await request.get(`/api/tools/video-upload/${jobId}/process-preview`, { headers });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toMatchObject({ requiresAshedConnection: false, canProcess: true });
  expect((await request.post(`/api/tools/video-upload/${jobId}/approve`, { headers })).status()).toBe(200);
});

test("native Frontline concurrent submits for the same event and member stay single", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const jobA = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 100, frontlineStage: 5, rank: 1 }],
  });
  const jobB = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 200, frontlineStage: 5, rank: 1 }],
  });
  const headers = { Cookie: authCookieHeader(f.officer) };
  const results = await Promise.all([
    request.post(`/api/tools/video-upload/${jobA.jobId}/submit`, { headers, data: submitBody(jobA, event.id) }),
    request.post(`/api/tools/video-upload/${jobB.jobId}/submit`, { headers, data: submitBody(jobB, event.id) }),
  ]);
  expect(results.map((r) => r.status()).sort()).toEqual([200, 200]);
  const members = await sql`SELECT member_id FROM hq_event_members WHERE hq_event_id = ${event.id} AND member_id = ${f.member.memberId}`;
  expect(members).toHaveLength(1);
  for (const jobId of [jobA.jobId, jobB.jobId]) {
    expect((await sql`SELECT status FROM video_jobs WHERE id = ${jobId}`)[0].status).toBe("complete");
  }

  const jobC = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.officer.memberId, memberName: f.officer.memberName, score: 50, frontlineStage: 2, rank: 4 }],
  });
  const sameJob = await Promise.all([
    request.post(`/api/tools/video-upload/${jobC.jobId}/submit`, { headers, data: submitBody(jobC, event.id) }),
    request.post(`/api/tools/video-upload/${jobC.jobId}/submit`, { headers, data: { ...submitBody(jobC, event.id), requestId: randomUUID() } }),
  ]);
  const officerRows = await sql`SELECT id FROM hq_event_members WHERE hq_event_id = ${event.id} AND member_id = ${f.officer.memberId}`;
  expect(officerRows).toHaveLength(1);
  expect(sameJob.some((r) => r.status() === 200)).toBe(true);
});

test("native Frontline source-owned delete and move cleanup leaves other captures alone", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const eventB = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const headers = { Cookie: authCookieHeader(f.officer) };

  const jobA = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 100, frontlineStage: 5, rank: 1 }],
  });
  expect((await request.post(`/api/tools/video-upload/${jobA.jobId}/submit`, { headers, data: submitBody(jobA, event.id) })).status()).toBe(200);

  const jobB = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 222, frontlineStage: 5, rank: 1 }],
  });
  expect((await request.post(`/api/tools/video-upload/${jobB.jobId}/submit`, { headers, data: submitBody(jobB, event.id) })).status()).toBe(200);

  const deleteBody = submitBody(jobA, event.id);
  deleteBody.rows[0] = { ...deleteBody.rows[0]!, deleted: true } as typeof deleteBody.rows[0];
  const deleteStatus = (await sql`SELECT status FROM video_jobs WHERE id = ${jobA.jobId}`)[0].status;
  if (deleteStatus !== "complete") throw new Error(`jobA unexpected status ${deleteStatus}`);
  const del = await request.post(`/api/tools/video-upload/${jobA.jobId}/submit`, { headers, data: deleteBody });
  expect(del.status()).toBe(200);
  const [kept] = await sql`SELECT metadata FROM hq_event_members WHERE hq_event_id = ${event.id} AND member_id = ${f.member.memberId}`;
  expect(kept.metadata).toMatchObject({ score: 222, sourceJobId: jobB.jobId, sourceRowId: jobB.rows[0]!.id });

  const moveBody = submitBody(jobB, eventB.id);
  const move = await request.post(`/api/tools/video-upload/${jobB.jobId}/submit`, { headers, data: moveBody });
  expect(move.status()).toBe(200);
  expect((await sql`SELECT id FROM hq_event_members WHERE hq_event_id = ${event.id} AND member_id = ${f.member.memberId}`)).toHaveLength(0);
  expect((await sql`SELECT id FROM hq_event_members WHERE hq_event_id = ${eventB.id} AND member_id = ${f.member.memberId}`)).toHaveLength(1);

  const explicitDelete = await request.post(`/api/tools/video-upload/${jobB.jobId}/submit`, {
    headers,
    data: { ...moveBody, rows: [{ id: jobB.rows[0]!.id, deleted: true }], requestId: randomUUID() },
  });
  expect(explicitDelete.status()).toBe(200);
  expect((await sql`SELECT id FROM hq_event_members WHERE hq_event_id = ${eventB.id} AND member_id = ${f.member.memberId}`)).toHaveLength(0);
});

test("native Frontline submit rolls back the whole write when the transaction fails mid-save", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const job = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.officer.memberId, memberName: f.officer.memberName, score: 900, frontlineStage: 4, rank: 8 }],
  });
  const headers = { Cookie: authCookieHeader(f.officer) };
  const constraint = `frontline_rollback_${randomUUID().replaceAll("-", "")}`;
  const target = job.jobId.replaceAll("'", "''");
  await sql.unsafe(`ALTER TABLE audit_log ADD CONSTRAINT "${constraint}" CHECK (resource_id IS DISTINCT FROM '${target}') NOT VALID`);
  try {
    const res = await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers, data: submitBody(job, event.id) });
    expect(res.status()).toBe(500);
    expect((await res.json()).code).toBe("frontlineSaveFailed");
    expect((await sql`SELECT count(*)::int AS count FROM hq_event_members WHERE hq_event_id = ${event.id}`)[0].count).toBe(0);
    expect((await sql`SELECT status FROM video_jobs WHERE id = ${job.jobId}`)[0].status).toBe("review");
    expect((await sql`SELECT rank FROM parsed_rows WHERE id = ${job.rows[0]!.id}`)[0].rank).toBe(8);
  } finally {
    await sql.unsafe(`ALTER TABLE audit_log DROP CONSTRAINT "${constraint}"`);
  }
});

test("native Frontline submit rejects a rank the integer column cannot store", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const job = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.officer.memberId, memberName: f.officer.memberName, score: 900, frontlineStage: 4, rank: 8 }],
  });
  const headers = { Cookie: authCookieHeader(f.officer) };
  const body = submitBody(job, event.id);
  body.rows[0]!.rank = 3_000_000_000;
  const res = await request.post(`/api/tools/video-upload/${job.jobId}/submit`, { headers, data: body });
  expect(res.status()).toBe(400);
  expect((await res.json()).code).toBe("frontlineInvalidRows");
  expect((await sql`SELECT count(*)::int AS count FROM hq_event_members WHERE hq_event_id = ${event.id}`)[0].count).toBe(0);
  expect((await sql`SELECT status FROM video_jobs WHERE id = ${job.jobId}`)[0].status).toBe("review");
});

for (const locale of ["en-US", "pt-BR"] as const) {
  test(`native Frontline review creates an event, edits, saves and shows stage on profile with ${locale} copy`, async ({ page }) => {
    const sql = getE2eSql();
    const f = await createNativeFrontlineScenario(sql);
    const job = await seedFrontlineReviewJob(sql, {
      allianceId: f.allianceId,
      actor: f.owner,
      recordedDate,
      rows: [{ memberId: f.owner.memberId, memberName: f.owner.memberName, score: 2670, frontlineStage: 5, rank: 3 }],
    });
    await page.context().addCookies(playwrightAuthCookies(f.owner));
    await page.goto(`/${locale}/tools/video-upload/${job.jobId}/review`);

    await page.getByRole("button", { name: locale === "en-US" ? "Create event for this date" : "Criar evento para esta data", exact: true }).click();

    const stageInput = page.getByLabel(locale === "en-US" ? "Stage" : "Fase");
    const rankInput = page.getByLabel(locale === "en-US" ? "Rank" : "Posição");
    const scoreInput = page.getByLabel(locale === "en-US" ? "Score" : "Pontuação");
    const save = page.getByRole("button", { name: locale === "en-US" ? "Save 1 scores" : "Salvar 1 pontuações", exact: true });

    await rankInput.fill("1.5");
    await expect(save).toBeDisabled();
    await stageInput.fill("abc");
    await expect(save).toBeDisabled();

    await page.waitForTimeout(750);
    await page.reload();
    await expect(stageInput).toHaveValue("abc");
    await expect(rankInput).toHaveValue("1.5");

    await stageInput.fill("6");
    await rankInput.fill("3");
    await scoreInput.fill("2700");

    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(locale === "en-US" ? "Saved 1 Frontline Breakthrough results in Alliance HQ." : "1 resultados de Frontline Breakthrough salvos no Alliance HQ.", { exact: true })).toBeVisible();

    const [eventRow] = await sql`SELECT id FROM hq_events WHERE alliance_id = ${f.allianceId} AND score_target = 'frontline-breakthrough'`;
    const [audit] = await sql`SELECT action, hq_user_id, alliance_id, resource_id FROM audit_log WHERE action = 'hq_events.created' AND resource_id = ${eventRow.id}`;
    expect(audit).toMatchObject({ hq_user_id: f.owner.hqUserId, alliance_id: f.allianceId, resource_id: eventRow.id });
    const [saved] = await sql`SELECT metadata FROM hq_event_members WHERE hq_event_id = ${eventRow.id} AND member_id = ${f.owner.memberId}`;
    expect(saved.metadata).toMatchObject({ score: 2700, frontlineStage: 6, rank: 3 });

    await page.goto(`/${locale}/tools/video-upload/${job.jobId}/event`);
    await expect(page.getByRole("button", { name: locale === "en-US" ? "Save 1 scores" : "Salvar 1 pontuações", exact: true })).toBeEnabled();
    await expect(page.getByLabel(locale === "en-US" ? "Stage" : "Fase")).toHaveValue("6");
    await expect(page.getByLabel(locale === "en-US" ? "Score" : "Pontuação")).toHaveValue(/2[.,]?700/);

    await page.goto(`/${locale}/members/${f.owner.memberId}`);
    await expect(page.getByText(locale === "en-US" ? "Stage 6" : "Fase 6", { exact: false }).first()).toBeVisible();
  });
}

test("completed native Frontline capture allows deleting the last row and updating with zero active rows", async ({ page }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createFrontlineEvent(sql, { allianceId: f.allianceId });
  const job = await seedFrontlineReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.officer,
    recordedDate,
    hqEventId: event.id,
    rows: [{ memberId: f.officer.memberId, memberName: f.officer.memberName, score: 900, frontlineStage: 4, rank: 8 }],
  });
  await page.context().addCookies(playwrightAuthCookies(f.officer));
  await page.goto(`/en-US/tools/video-upload/${job.jobId}/review`);
  await page.getByRole("button", { name: "Save 1 scores", exact: true }).click();
  await expect(page.getByText("Saved 1 Frontline Breakthrough results in Alliance HQ.", { exact: true })).toBeVisible();

  await page.goto(`/en-US/tools/video-upload/${job.jobId}/event`);
  await page.getByRole("button", { name: "Delete" }).click();
  const update = page.getByRole("button", { name: "Save 0 scores", exact: true });
  await expect(update).toBeEnabled();
  const [submitRes] = await Promise.all([
    page.waitForResponse((res) => res.url().includes(`/api/tools/video-upload/${job.jobId}/submit`) && res.request().method() === "POST"),
    update.click(),
  ]);
  expect(submitRes.status()).toBe(200);
  await expect(page.getByText("Saved 0 Frontline Breakthrough results in Alliance HQ.", { exact: true })).toBeVisible();

  expect(
    (await sql`SELECT count(*)::int AS count FROM hq_event_members WHERE hq_event_id = ${event.id}`)[0].count,
  ).toBe(0);
});
