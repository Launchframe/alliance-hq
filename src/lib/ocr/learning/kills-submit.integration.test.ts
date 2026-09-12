import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { assertE2eDatabaseUrl } from "../../../../scripts/e2e-database-url-guard.mjs";
import { createNativeAlliance, createPlatformMaintainerSession, getE2eSql, closeE2eSql } from "../../../../e2e/fixtures/db";
import { getDb, getSqlClient, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";

const state = vi.hoisted(() => ({
  session: null as { id: string; hqUserId: string; allianceId: string; currentAllianceId: string } | null,
  roster: [] as Array<{ id: string; current_name: string; alliance_id: string }>,
  create: vi.fn(), remove: vi.fn(), failConfirmation: false,
}));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireApiSession: () => state.session, getAshedConnection: () => ({ appId: "fixture", token: "fixture", originUrl: "https://ashed.online" }) }));
vi.mock("@/lib/base44/fetch", async (original) => ({ ...await original<typeof import("@/lib/base44/fetch")>(), base44ListMembers: async () => state.roster }));
vi.mock("@/lib/video/submit-dispatch", () => ({ dispatchScoreSubmit: (...args: unknown[]) => state.create(...args) }));
vi.mock("@/lib/video/ashed-event-provision.server", () => ({ replaceAshedScoresForContext: (...args: unknown[]) => state.remove(...args), resolveOrCreateAshedEvent: vi.fn() }));
vi.mock("@/lib/events/video-jobs", () => ({ emitVideoJobStatus: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/feedback/solicited-eligibility", () => ({ getSolicitedEligibility: async () => ({ showSolicitedFeedback: false, completedUploadCount: 1 }) }));
vi.mock("@/lib/eur/satisfaction", () => ({ notifyEurVideoEvidence: async () => undefined }));
vi.mock("@/lib/ocr/learning/feedback.server", async (original) => {
  const actual = await original<typeof import("./feedback.server")>();
  return { ...actual, confirmReviewFeedback: (...args: Parameters<typeof actual.confirmReviewFeedback>) => state.failConfirmation ? Promise.reject(new Error("fixture_metadata_outage")) : actual.confirmReviewFeedback(...args) };
});

import { POST } from "@/app/api/tools/video-upload/[jobId]/submit/route";
let used = false;
async function fixture() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== process.env.E2E_DATABASE_URL?.trim()) throw new Error("test_database_mismatch");
  used = true;
  const user = await createPlatformMaintainerSession(getE2eSql());
  const { allianceId } = await createNativeAlliance(getE2eSql(), { tag: `KF${nanoid(4)}`, name: "Kills feedback fixture" });
  const externalId = `external-${nanoid()}`, jobId = nanoid(), parseSessionId = nanoid(), rowId = nanoid();
  await getDb().update(schema.alliances).set({ operatingMode: "ashed", ashedAllianceId: externalId }).where(eq(schema.alliances.id, allianceId));
  await getDb().update(schema.sessions).set({ currentAllianceId: allianceId, allianceId }).where(eq(schema.sessions.id, user.sessionId));
  await getDb().insert(schema.videoJobs).values({ id: jobId, sessionId: user.sessionId, hqUserId: user.hqUserId, enqueuedByHqUserId: user.hqUserId, allianceId, scoreTarget: "alliance-kills-video", status: "review", parseSessionId });
  await getDb().insert(schema.parseSessions).values({ id: parseSessionId, jobId, sessionId: user.sessionId, allianceId, scoreTarget: "alliance-kills-video" });
  await getDb().insert(schema.parsedRows).values({ id: rowId, parseSessionId, ocrName: "Alpha", memberId: "member-a", memberName: "Alpha", score: "100", frameIndex: 0 });
  state.session = { id: user.sessionId, hqUserId: user.hqUserId, allianceId, currentAllianceId: allianceId };
  state.roster = [{ id: "member-a", current_name: "Alpha", alliance_id: externalId }];
  const body = { recordedDate: "2026-09-11", requestId: randomUUID(), ocrFeedbackVersion: 1, rows: [{ id: rowId, memberId: "member-a", memberName: "Alpha", score: "200", ocrName: "Alpha", frameIndex: 0, deleted: false }] };
  const submit = (data: unknown = body) => POST(new Request(`http://localhost/api/tools/video-upload/${jobId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), { params: Promise.resolve({ jobId }) });
  return { allianceId, jobId, parseSessionId, body, submit };
}

describe.skipIf(process.env.OCR_LEARNING_DB_TEST !== "1")("Kills submit feedback boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); state.failConfirmation = false; state.create.mockResolvedValue(undefined); state.remove.mockResolvedValue(undefined); });
  afterAll(async () => { await closeE2eSql(); if (used) await getSqlClient().end({ timeout: 5 }); });

  it("leaves scores successful when confirmation is deferred, and retries only feedback", async () => {
    const f = await fixture();
    state.failConfirmation = true;
    const response = await f.submit();
    expect(response.status, await response.text()).toBe(200);
    expect(state.create).toHaveBeenCalledOnce();
    const [event] = await getDb().select().from(schema.ocrFeedbackEvents).where(eq(schema.ocrFeedbackEvents.jobId, f.jobId));
    const [job] = await getDb().select().from(schema.videoJobs).where(eq(schema.videoJobs.id, f.jobId));
    expect(job.status).toBe("complete");
    expect(event.status).toBe("pending");
    const actual = await vi.importActual<typeof import("./feedback.server")>("./feedback.server");
    expect(await actual.confirmReviewFeedback(f.allianceId, event.id)).toBe(true);
    expect(state.create).toHaveBeenCalledOnce();
  });

  it("cannot confirm a failed upstream write", async () => {
    const f = await fixture();
    state.create.mockRejectedValueOnce(new Error("fixture_upstream_failure"));
    const response = await f.submit();
    expect(response.status).toBe(500);
    const [event] = await getDb().select().from(schema.ocrFeedbackEvents).where(eq(schema.ocrFeedbackEvents.jobId, f.jobId));
    const actual = await vi.importActual<typeof import("./feedback.server")>("./feedback.server");
    expect(await actual.confirmReviewFeedback(f.allianceId, event.id)).toBe(false);
  });

  it("distinguishes server-detected ghosts from explicit human deletions", async () => {
    const f = await fixture();
    const ghostId = nanoid(), humanId = nanoid();
    await getDb().insert(schema.parsedRows).values([
      { id: ghostId, parseSessionId: f.parseSessionId, ocrName: "Bravo", score: "200", frameIndex: 2 },
      { id: humanId, parseSessionId: f.parseSessionId, ocrName: "Unclear", score: "999", frameIndex: 3 },
    ]);
    const response = await f.submit({ ...f.body, rows: [...f.body.rows,
      { id: ghostId, memberId: null, memberName: "Bravo", ocrName: "Bravo", score: "200", frameIndex: 2, deleted: false },
      { id: humanId, memberId: null, memberName: "Unclear", ocrName: "Unclear", score: "999", frameIndex: 3, deleted: true },
    ] });
    expect(response.status, await response.text()).toBe(200);
    const [event] = await getDb().select().from(schema.ocrFeedbackEvents).where(eq(schema.ocrFeedbackEvents.jobId, f.jobId));
    expect(event.payload).toMatchObject({ rows: [
      { wasSubmitted: true, deletionSource: null },
      { id: ghostId, wasSubmitted: false, deletionSource: "automatic" },
      { id: humanId, wasSubmitted: false, deletionSource: "human" },
    ] });
  });

  it("rejects foreign row and member ids before upstream writes", async () => {
    const f = await fixture();
    expect((await f.submit({ ...f.body, rows: [{ ...f.body.rows[0], id: "foreign-row" }] })).status).toBe(400);
    expect((await f.submit({ ...f.body, rows: [{ ...f.body.rows[0], memberId: "foreign-member" }] })).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
});
