import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { stableJson } from "../benchmark/json.shared";
import { OcrLearningError, ocrIdSchema } from "../benchmark/types.shared";
import { disabledWorkerPolicy, workerPolicySchema, type PipelineDefinition, type WorkerPolicy } from "./control.shared";
import type { OcrActor } from "./corpus.server";
import type { OcrTransaction } from "./recording.server";

export const workerHash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
export const pipelineId = (allianceId: string, definition: PipelineDefinition) => workerHash({ allianceId, definition });

export async function lockWorker(tx: OcrTransaction, allianceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ocr-worker:${allianceId}`}, 0))`);
}

export async function workerAudit(tx: OcrTransaction, actor: OcrActor, allianceId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ id: nanoid(), allianceId, hqUserId: actor.hqUserId, sessionId: actor.sessionId, action, severity: "update", resourceType: "ocr_worker", resourceId, metadata });
}

export async function workerUsage(tx: OcrTransaction, allianceId: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [compute] = await tx.select({ seconds: sql<number>`coalesce(sum(${schema.ocrWorkerAttempts.reservedSeconds}), 0)::double precision` }).from(schema.ocrWorkerAttempts).where(and(eq(schema.ocrWorkerAttempts.allianceId, allianceId), gte(schema.ocrWorkerAttempts.startedAt, today)));
  const [storage] = await tx.select({ bytes: sql<number>`coalesce(sum(${schema.ocrWorkerArtifacts.bytes} * 2), 0)::double precision` }).from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.allianceId, allianceId), ne(schema.ocrWorkerArtifacts.state, "deleted")));
  return { reservedSeconds: Number(compute.seconds), reservedBytes: Number(storage.bytes) };
}

export async function loadWorkerPolicy(allianceId: string) {
  if (!ocrIdSchema.safeParse(allianceId).success) throw new OcrLearningError("invalid_scope");
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.ocrWorkerPolicies).where(eq(schema.ocrWorkerPolicies.allianceId, allianceId)).limit(1);
    const policy = workerPolicySchema.safeParse(row?.policy ?? disabledWorkerPolicy);
    if (!policy.success) throw new OcrLearningError("invalid_worker_policy", 409);
    return { revision: row?.revision ?? 0, policy: policy.data, ...await workerUsage(tx, allianceId) };
  });
}

export async function saveWorkerPolicy(allianceId: string, expectedRevision: number, input: WorkerPolicy, actor: OcrActor) {
  const parsed = workerPolicySchema.safeParse(input);
  if (!ocrIdSchema.safeParse(allianceId).success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !parsed.success) throw new OcrLearningError("invalid_worker_policy");
  return getDb().transaction(async (tx) => {
    await lockWorker(tx, allianceId);
    const [current] = await tx.select().from(schema.ocrWorkerPolicies).where(eq(schema.ocrWorkerPolicies.allianceId, allianceId)).limit(1);
    if ((current?.revision ?? 0) !== expectedRevision) throw new OcrLearningError("stale_worker_policy", 409);
    const revision = expectedRevision + 1;
    const values = { revision, policy: parsed.data, updatedByHqUserId: actor.hqUserId, updatedAt: new Date() };
    await tx.insert(schema.ocrWorkerPolicies).values({ allianceId, ...values }).onConflictDoUpdate({ target: schema.ocrWorkerPolicies.allianceId, set: values });
    await workerAudit(tx, actor, allianceId, "ocr.worker.policy", allianceId, { revision, enabled: parsed.data.enabled, workerCodeHash: parsed.data.trustedWorkerCodeHash });
    return { revision, policy: parsed.data, ...await workerUsage(tx, allianceId) };
  });
}
