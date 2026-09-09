import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ resolve: vi.fn(), validate: vi.fn() }));
vi.mock("@/lib/vs-scores/ashed-transport.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vs-scores/ashed-transport.server")>();
  return {
    ...actual,
    resolveVsAshedConnection: transport.resolve,
    validateVsAshedMember: transport.validate,
  };
});

import { getE2eSql, closeE2eSql } from "../../../e2e/fixtures/db";
import { createNativeVsScenario, seedVsReviewJob } from "../../../e2e/fixtures/vs-evidence";
import { getSqlClient } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { addCalendarDays } from "@/lib/trains/game-time";
import { changeVsBatches, commitReviewedVsScores, listVsHeads } from "./repository.server";
import { loadVsWeekEvidence } from "./load-week.server";
import { syncVsScoresForAlliance } from "./sync.server";
import { VsSyncError } from "@/lib/vs-scores/ashed-transport.server";

const sunday = "2026-09-06";
const monday = "2026-08-31";
let usedDatabase = false;
async function setup() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== (process.env.E2E_DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim())) throw new Error("test_database_mismatch");
  usedDatabase = true;
  const sql = getE2eSql();
  const fixture = await createNativeVsScenario(sql);
  async function submit(date: string, score: number, period: "daily" | "weekly" = "daily", actor = fixture.officer) {
    const job = await seedVsReviewJob(sql, { allianceId: fixture.allianceId, actor, recordedDate: date, rows: [{ memberId: fixture.member.memberId, memberName: fixture.member.memberName, score }] });
    const input = { ...job, allianceId: fixture.allianceId, hqUserId: actor.hqUserId, recordedDate: date, period, requestId: randomUUID(), expectedRevision: 0 };
    return { ...job, input, result: await commitReviewedVsScores(input) };
  }
  return { sql, ...fixture, submit };
}

beforeEach(() => {
  vi.clearAllMocks();
  transport.resolve.mockResolvedValue(null);
  transport.validate.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected_external_request")));
});

describe.skipIf(process.env.VS_EVIDENCE_DB_TEST !== "1")("canonical VS evidence with guarded real DB", () => {
  afterAll(async () => { vi.unstubAllGlobals(); await closeE2eSql(); if (usedDatabase) await getSqlClient().end({ timeout: 5 }); });

  it("commits once across duplicate concurrent requests and preserves explicit zero", async () => {
    const f = await setup();
    const job = await seedVsReviewJob(f.sql, { allianceId: f.allianceId, actor: f.officer, recordedDate: monday, rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 0 }] });
    const input = { ...job, allianceId: f.allianceId, hqUserId: f.officer.hqUserId, recordedDate: monday, period: "daily" as const, requestId: randomUUID(), expectedRevision: 0 };
    const [a, b] = await Promise.all([commitReviewedVsScores(input), commitReviewedVsScores(input)]);
    expect(a.batchId).toBe(b.batchId);
    expect(a.vsRevision).toBe(1);
    expect((await listVsHeads(f.allianceId))[0].score).toBe(0);
    expect((await f.sql`SELECT id FROM vs_score_revisions WHERE alliance_id = ${f.allianceId}`)).toHaveLength(1);
    expect((await f.sql`SELECT status FROM video_jobs WHERE id = ${job.jobId}`)[0].status).toBe("complete");
    expect((await f.sql`SELECT id FROM vs_score_sync_scopes WHERE alliance_id = ${f.allianceId}`)).toHaveLength(0);
  }, 20000);

  it("rejects replay of an older request after correction or deletion", async () => {
    const f = await setup();
    const saved = await f.submit(monday, 12);
    await commitReviewedVsScores({ ...saved.input, rows: [{ ...saved.rows[0], score: "24" }], expectedRevision: 1, requestId: randomUUID() });
    await expect(commitReviewedVsScores({ ...saved.input, expectedRevision: undefined })).rejects.toMatchObject({ code: "stale" });
    expect((await listVsHeads(f.allianceId))[0].score).toBe(24);
    await changeVsBatches({ allianceId: f.allianceId, hqUserId: f.officer.hqUserId, batchIds: [saved.result.batchId], expectedVersions: { [saved.result.batchId]: 2 }, canManageAny: false });
    await expect(commitReviewedVsScores({ ...saved.input, expectedRevision: undefined })).rejects.toMatchObject({ code: "stale" });
    expect((await listVsHeads(f.allianceId))[0].score).toBeNull();
  }, 20000);

  it("rejects foreign commanders and foreign parsed rows atomically", async () => {
    const f = await setup();
    const other = await setup();
    const job = await seedVsReviewJob(f.sql, { allianceId: f.allianceId, actor: f.officer, recordedDate: monday, rows: [{ memberId: f.member.memberId, memberName: f.member.memberName, score: 1 }] });
    const input = { ...job, allianceId: f.allianceId, hqUserId: f.officer.hqUserId, recordedDate: monday, period: "daily" as const, requestId: randomUUID() };
    await expect(commitReviewedVsScores({ ...input, rows: [{ ...job.rows[0], memberId: other.member.memberId }] })).rejects.toMatchObject({ code: "invalid_member" });
    await expect(commitReviewedVsScores({ ...input, rows: [{ ...job.rows[0], id: "foreign-row" }] })).rejects.toMatchObject({ code: "invalid_rows" });
    expect(await listVsHeads(f.allianceId)).toHaveLength(0);
    expect((await f.sql`SELECT status FROM video_jobs WHERE id = ${job.jobId}`)[0].status).toBe("review");
  }, 20000);

  it("derives Saturday from complete dependencies and recomputes corrections", async () => {
    const f = await setup();
    const first = await f.submit(monday, 7_200_000);
    for (let day = 1; day < 5; day++) await f.submit(addCalendarDays(monday, day), 7_200_000);
    const weekly = await f.submit(sunday, 43_200_000, "weekly");
    const saturday = async () => (await listVsHeads(f.allianceId, { recordedDate: "2026-09-05", period: "daily" }))[0];
    expect(await saturday()).toMatchObject({ origin: "derived", score: 7_200_000, basis: expect.any(Array) });
    await commitReviewedVsScores({ ...first.input, rows: [{ ...first.rows[0], score: "8200000" }], expectedRevision: 1, requestId: randomUUID() });
    expect(await saturday()).toMatchObject({ origin: "derived", score: 6_200_000 });
    await changeVsBatches({ allianceId: f.allianceId, hqUserId: f.officer.hqUserId, batchIds: [weekly.result.batchId], expectedVersions: { [weekly.result.batchId]: 1 }, canManageAny: false });
    expect((await saturday()).score).toBeNull();
    expect((await loadVsWeekEvidence(f.allianceId, sunday)).members.get(f.member.memberId)).toMatchObject({ state: "partial", score: null });
  }, 20000);

  it("never overwrites an explicit Saturday and holds conflicting evidence", async () => {
    const f = await setup();
    for (let day = 0; day < 5; day++) await f.submit(addCalendarDays(monday, day), 7_200_000);
    await f.submit("2026-09-05", 1);
    await f.submit(sunday, 43_200_000, "weekly");
    expect((await listVsHeads(f.allianceId, { recordedDate: "2026-09-05" }))[0]).toMatchObject({ origin: "hq", score: 1 });
    expect((await loadVsWeekEvidence(f.allianceId, sunday)).members.get(f.member.memberId)?.state).toBe("conflict");
  }, 20000);

  it("moves a batch without leaving old evidence, and deletes without reviving old revisions", async () => {
    const f = await setup();
    const first = await f.submit(monday, 12);
    await changeVsBatches({ allianceId: f.allianceId, hqUserId: f.officer.hqUserId, batchIds: [first.result.batchId], expectedVersions: { [first.result.batchId]: 1 }, canManageAny: false, newRecordedDate: "2026-09-01" });
    expect((await listVsHeads(f.allianceId, { recordedDate: monday }))[0].score).toBeNull();
    const target = (await listVsHeads(f.allianceId, { recordedDate: "2026-09-01" }))[0];
    expect(target.score).toBe(12);
    await changeVsBatches({ allianceId: f.allianceId, hqUserId: f.officer.hqUserId, batchIds: [target.batchId!], expectedVersions: { [target.batchId!]: 2 }, canManageAny: false });
    expect((await listVsHeads(f.allianceId)).every((head) => head.score == null)).toBe(true);
    expect((await f.sql`SELECT id FROM vs_score_revisions WHERE alliance_id = ${f.allianceId}`)).toHaveLength(4);
  }, 20000);

  it("does not let deleting an older batch remove a newer batch’s score", async () => {
    const f = await setup();
    const first = await f.submit(monday, 12);
    const second = await f.submit(monday, 24, "daily", f.otherOfficer);
    await changeVsBatches({ allianceId: f.allianceId, hqUserId: f.officer.hqUserId, batchIds: [first.result.batchId], expectedVersions: { [first.result.batchId]: 1 }, canManageAny: false });
    expect((await listVsHeads(f.allianceId))[0]).toMatchObject({ score: 24, batchId: second.result.batchId });
    await expect(changeVsBatches({ allianceId: f.allianceId, hqUserId: f.officer.hqUserId, batchIds: [second.result.batchId], expectedVersions: { [second.result.batchId]: 1 }, canManageAny: false })).rejects.toMatchObject({ code: "forbidden" });
  }, 20000);

  it("reconciles a partial upstream success without rolling back HQ or duplicating the upsert", async () => {
    const f = await setup();
    const externalId = `remote-${f.allianceId}`;
    await f.sql`UPDATE alliances SET operating_mode = 'ashed', ashed_alliance_id = ${externalId} WHERE id = ${f.allianceId}`;
    const saved = await f.submit(monday, 12);
    transport.resolve.mockResolvedValue({ allianceId: externalId, appId: "test-app", connection: { appId: "test-app", token: "test-only", originUrl: "https://ashed.online" } });
    const remote: Array<Record<string, unknown>> = [];
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === "GET") return Response.json(new URL(url).searchParams.get("skip") === "0" ? remote : []);
      const body = JSON.parse(String(options.body));
      writes++;
      for (const row of body.scores) remote.push({ ...row, id: `record-${writes}`, alliance_id: externalId, recorded_date: body.recorded_date, is_weekly: body.is_weekly });
      return new Response(null, { status: 500 });
    }));
    await syncVsScoresForAlliance(f.allianceId);
    expect((await f.sql`SELECT status FROM video_jobs WHERE id = ${saved.jobId}`)[0].status).toBe("complete");
    expect((await f.sql`SELECT status FROM vs_score_sync_scopes WHERE alliance_id = ${f.allianceId}`)[0].status).toBe("failed");
    await f.sql`UPDATE vs_score_sync_scopes SET next_attempt_at = to_timestamp(0) WHERE alliance_id = ${f.allianceId}`;
    await syncVsScoresForAlliance(f.allianceId);
    expect(writes).toBe(1);
    expect((await f.sql`SELECT status FROM vs_score_sync_scopes WHERE alliance_id = ${f.allianceId}`)[0].status).toBe("synced");
    expect((await listVsHeads(f.allianceId))[0].score).toBe(12);
  }, 20000);

  it("preserves local commits through missing Ashed credentials", async () => {
    const f = await setup();
    await f.sql`UPDATE alliances SET operating_mode = 'ashed', ashed_alliance_id = ${`remote-${f.allianceId}`} WHERE id = ${f.allianceId}`;
    const saved = await f.submit(monday, 7_200_000);
    transport.resolve.mockRejectedValue(new VsSyncError("credentials_required"));
    await syncVsScoresForAlliance(f.allianceId);
    expect((await listVsHeads(f.allianceId))[0].score).toBe(7_200_000);
    expect((await f.sql`SELECT status FROM video_jobs WHERE id = ${saved.jobId}`)[0].status).toBe("complete");
    expect((await f.sql`SELECT status FROM vs_score_sync_scopes WHERE alliance_id = ${f.allianceId}`)[0].status).toBe("credentials_required");
  }, 20000);
});
