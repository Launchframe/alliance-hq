import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { assertE2eDatabaseUrl } from "../../../../scripts/e2e-database-url-guard.mjs";
import { createNativeAlliance, createPlatformMaintainerSession, getE2eSql, closeE2eSql } from "../../../../e2e/fixtures/db";
import { getDb, getSqlClient, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { recordPipelineRun } from "./recording.server";
import { confirmReviewFeedback, prepareReviewFeedback } from "./feedback.server";
import type { OcrTarget } from "../benchmark/types.shared";

let used = false;
async function fixture(target: OcrTarget = "alliance-kills-video") {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== process.env.E2E_DATABASE_URL?.trim()) throw new Error("test_database_mismatch");
  used = true;
  const user = await createPlatformMaintainerSession(getE2eSql());
  const { allianceId } = await createNativeAlliance(getE2eSql(), { tag: `OCR${nanoid(4)}`, name: "OCR run fixture" });
  const jobId = nanoid(), parseSessionId = nanoid(), rowId = nanoid();
  await getDb().insert(schema.videoJobs).values({ id: jobId, sessionId: user.sessionId, allianceId, scoreTarget: target, status: "parsing", parseSessionId });
  await getDb().insert(schema.parseSessions).values({ id: parseSessionId, jobId, sessionId: user.sessionId, allianceId, scoreTarget: target });
  await getDb().insert(schema.parsedRows).values({ id: rowId, parseSessionId, ocrName: "Alpha", memberId: "member-a", memberName: "Alpha", score: "100", frameIndex: 0 });
  const rows = await getDb().select().from(schema.parsedRows).where(eq(schema.parsedRows.parseSessionId, parseSessionId));
  const runInput = { jobId, parseSessionId, allianceId, scoreTarget: target, engine: "ashed", sourceSha256: "a".repeat(64), sourceKind: "original_video" as const, extractionConfig: { mode: "scene", sceneThreshold: 0.25, credential: "not-retained" }, frames: [{ index: 0, buffer: Buffer.from("fixture-frame"), videoTimestampSeconds: 1 }], entries: [{ name: "Alpha", score: "100", _sourceFrameIndex: 0 }, { name: "Alpha", score: "100", _sourceFrameIndex: 0 }] };
  const runId = await recordPipelineRun(runInput);
  return { ...runInput, runInput, runId, rowId, rows, user };
}

describe.skipIf(process.env.OCR_LEARNING_DB_TEST !== "1")("immutable runs and durable review receipts", () => {
  afterAll(async () => { await closeE2eSql(); if (used) await getSqlClient().end({ timeout: 5 }); });

  it("retains repeated observations and the initial rows through later edits", async () => {
    const f = await fixture("vs-performance");
    expect(await recordPipelineRun(f.runInput)).toBe(f.runId);
    await getDb().update(schema.parsedRows).set({ score: "200" }).where(eq(schema.parsedRows.id, f.rowId));
    const [run] = await getDb().select().from(schema.ocrPipelineRuns).where(eq(schema.ocrPipelineRuns.id, f.runId));
    expect(run.manifest.observations).toHaveLength(2);
    expect(run.manifest.initialRows[0].score).toBe("100");
    expect(JSON.stringify(run.manifest)).not.toContain("not-retained");
    expect(run.manifest.frames[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires immutable completion proof, not merely a complete job, and confirms idempotently", async () => {
    const f = await fixture();
    const input = { allianceId: f.allianceId, jobId: f.jobId, parseSessionId: f.parseSessionId, scoreTarget: f.scoreTarget, hqUserId: f.user.hqUserId, requestId: randomUUID(), currentRows: f.rows, submittedRows: [{ id: f.rowId, memberId: "member-a", memberName: "Alpha", score: "200", deleted: false }], recordedDate: "2026-09-11" };
    const [a, b] = await Promise.all([prepareReviewFeedback(input), prepareReviewFeedback(input)]);
    expect(a).toBe(b);
    await getDb().update(schema.videoJobs).set({ status: "complete", ocrFeedbackReceiptId: a }).where(eq(schema.videoJobs.id, f.jobId));
    expect(await confirmReviewFeedback(f.allianceId, a)).toBe(false);
    await getDb().insert(schema.auditLog).values({ id: nanoid(), allianceId: f.allianceId, hqUserId: f.user.hqUserId, action: "video.submit", resourceId: f.jobId, metadata: { ocrFeedbackReceiptId: a } });
    expect(await confirmReviewFeedback(f.allianceId, a)).toBe(true);
    expect(await confirmReviewFeedback(f.allianceId, a)).toBe(true);
    const [event] = await getDb().select().from(schema.ocrFeedbackEvents).where(eq(schema.ocrFeedbackEvents.id, a));
    expect(event.status).toBe("confirmed");
    expect(event.runId).toBe(f.runId);
    expect(event.payload).toMatchObject({ baselineOrigin: "original_ocr", rows: [{ before: { score: "100" }, after: { score: "200" }, labelStatus: "candidate" }] });
    await expect(prepareReviewFeedback({ ...input, submittedRows: [{ ...input.submittedRows[0], score: "300" }] })).rejects.toMatchObject({ code: "feedback_request_conflict" });
  });

  it("rejects foreign run scopes and cannot confirm another alliance's receipt", async () => {
    const f = await fixture();
    await expect(recordPipelineRun({ ...f.runInput, allianceId: "foreign" })).rejects.toMatchObject({ code: "run_scope_mismatch" });
    const id = await prepareReviewFeedback({ allianceId: f.allianceId, jobId: f.jobId, parseSessionId: f.parseSessionId, scoreTarget: f.scoreTarget, hqUserId: f.user.hqUserId, requestId: randomUUID(), currentRows: f.rows, submittedRows: [{ id: f.rowId, score: "100" }], recordedDate: "2026-09-11" });
    expect(await confirmReviewFeedback("foreign", id)).toBe(false);
  });
});
