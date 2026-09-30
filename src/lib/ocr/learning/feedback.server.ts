import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { OcrLearningError, type OcrTarget } from "../benchmark/types.shared";
import { buildFeedbackPayload, snapshotReviewRows, type ReviewRowInput } from "./feedback.shared";
import { ocrContentHash, type OcrTransaction } from "./recording.server";

export type ReviewFeedbackInput = {
  allianceId: string; jobId: string; parseSessionId: string; scoreTarget: OcrTarget;
  hqUserId: string | null; requestId?: string; currentRows: ReviewRowInput[]; submittedRows: ReviewRowInput[];
  automaticDeletedIds?: readonly string[]; humanDeletesKnown?: boolean; recordedDate: string; period?: string;
};

async function writeReviewFeedback(tx: OcrTransaction, input: ReviewFeedbackInput, confirmed: boolean): Promise<string> {
  if (!input.hqUserId) throw new OcrLearningError("forbidden", 403);
  if (input.requestId != null && (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId))) throw new OcrLearningError("invalid_request");
  const [alliance] = await tx.select({ externalId: schema.alliances.ashedAllianceId }).from(schema.alliances).where(eq(schema.alliances.id, input.allianceId)).limit(1);
  const [parseSession] = await tx.select().from(schema.parseSessions).where(and(eq(schema.parseSessions.id, input.parseSessionId), eq(schema.parseSessions.jobId, input.jobId))).limit(1);
  if (!alliance || !parseSession || !parseSession.allianceId || ![input.allianceId, alliance.externalId].includes(parseSession.allianceId) || parseSession.scoreTarget !== input.scoreTarget) throw new OcrLearningError("run_scope_mismatch", 409);
  const requestKey = input.requestId ?? `legacy-${nanoid()}`;
  const intent = snapshotReviewRows(input.submittedRows);
  const requestDigest = ocrContentHash({ rows: intent.sort((a, b) => a.id.localeCompare(b.id)), automaticDeletedIds: [...(input.automaticDeletedIds ?? [])].sort(), humanDeletesKnown: input.humanDeletesKnown === true, recordedDate: input.recordedDate, period: input.period ?? null });
  const [existing] = await tx.select().from(schema.ocrFeedbackEvents).where(and(eq(schema.ocrFeedbackEvents.allianceId, input.allianceId), eq(schema.ocrFeedbackEvents.jobId, input.jobId), eq(schema.ocrFeedbackEvents.parseSessionId, input.parseSessionId), eq(schema.ocrFeedbackEvents.kind, "submit"), eq(schema.ocrFeedbackEvents.requestKey, requestKey))).limit(1);
  if (existing) {
    if (existing.requestDigest !== requestDigest || existing.recordedByHqUserId !== input.hqUserId || existing.scoreTarget !== input.scoreTarget) throw new OcrLearningError("feedback_request_conflict", 409);
    if (confirmed && existing.status !== "confirmed") await tx.update(schema.ocrFeedbackEvents).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(schema.ocrFeedbackEvents.id, existing.id));
    return existing.id;
  }
  const [run] = await tx.select().from(schema.ocrPipelineRuns).where(and(eq(schema.ocrPipelineRuns.parseSessionId, input.parseSessionId), eq(schema.ocrPipelineRuns.jobId, input.jobId), eq(schema.ocrPipelineRuns.allianceId, input.allianceId))).limit(1);
  if (run && (run.scoreTarget !== input.scoreTarget || ocrContentHash(run.manifest) !== run.manifestHash)) throw new OcrLearningError("run_scope_mismatch", 409);
  const payload = {
    ...buildFeedbackPayload(input.currentRows, input.submittedRows, input.automaticDeletedIds ?? [], run?.manifest.initialRows, input.humanDeletesKnown === true),
    context: { recordedDate: input.recordedDate, period: input.period ?? null },
    synthetic: run?.synthetic ?? null,
    legacyRequest: input.requestId == null,
  };
  const id = nanoid();
  const [inserted] = await tx.insert(schema.ocrFeedbackEvents).values({ id, allianceId: input.allianceId, jobId: input.jobId, parseSessionId: input.parseSessionId, runId: run?.id ?? null, scoreTarget: input.scoreTarget, kind: "submit", requestKey, requestDigest, payload, recordedByHqUserId: input.hqUserId, status: confirmed ? "confirmed" : "pending", confirmedAt: confirmed ? new Date() : null }).onConflictDoNothing().returning({ id: schema.ocrFeedbackEvents.id });
  if (inserted) return inserted.id;
  const [winner] = await tx.select().from(schema.ocrFeedbackEvents).where(and(eq(schema.ocrFeedbackEvents.allianceId, input.allianceId), eq(schema.ocrFeedbackEvents.jobId, input.jobId), eq(schema.ocrFeedbackEvents.parseSessionId, input.parseSessionId), eq(schema.ocrFeedbackEvents.kind, "submit"), eq(schema.ocrFeedbackEvents.requestKey, requestKey))).limit(1);
  if (!winner || winner.requestDigest !== requestDigest || winner.recordedByHqUserId !== input.hqUserId) throw new OcrLearningError("feedback_request_conflict", 409);
  return winner.id;
}

export function prepareReviewFeedback(input: ReviewFeedbackInput): Promise<string> {
  return getDb().transaction((tx) => writeReviewFeedback(tx, input, false));
}

export function recordConfirmedReview(tx: OcrTransaction, input: ReviewFeedbackInput): Promise<string> {
  return writeReviewFeedback(tx, input, true);
}

export async function confirmReviewFeedback(allianceId: string, receiptId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [receipt] = await tx.select().from(schema.ocrFeedbackEvents).where(and(eq(schema.ocrFeedbackEvents.id, receiptId), eq(schema.ocrFeedbackEvents.allianceId, allianceId))).limit(1).for("update");
    if (!receipt || receipt.status === "failed") return false;
    if (receipt.status === "confirmed") return true;
    const [proof] = await tx.select({ id: schema.auditLog.id }).from(schema.auditLog).where(and(
      eq(schema.auditLog.allianceId, allianceId), eq(schema.auditLog.resourceId, receipt.jobId), eq(schema.auditLog.action, "video.submit"),
      sql`${schema.auditLog.metadata}->>'ocrFeedbackReceiptId' = ${receipt.id}`,
    )).limit(1);
    if (!proof) return false;
    await tx.update(schema.ocrFeedbackEvents).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(schema.ocrFeedbackEvents.id, receipt.id));
    return true;
  });
}
