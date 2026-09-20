import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { OcrLearningError, ocrIdSchema, ocrHashSchema, type OcrCase } from "../benchmark/types.shared";
import { disabledMediaPolicy, mediaExtension, mediaUploadSchema, ocrMediaPolicySchema, type OcrMediaPolicy, type OcrMediaUpload } from "./media.shared";
import { ocrContentHash, type OcrTransaction } from "./recording.server";
import { createCandidateCase, type OcrActor } from "./corpus.server";

export async function lockMedia(tx: OcrTransaction, allianceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ocr-media:${allianceId}`}))`);
}
async function usage(tx: OcrTransaction, allianceId: string): Promise<number> {
  const [row] = await tx.select({ bytes: sql<string>`coalesce(sum(${schema.ocrMediaObjects.reservedBytes}), 0)::text` }).from(schema.ocrMediaObjects).where(and(eq(schema.ocrMediaObjects.allianceId, allianceId), ne(schema.ocrMediaObjects.state, "deleted")));
  return Number(row?.bytes ?? 0);
}
async function auditMedia(tx: OcrTransaction, actor: OcrActor, allianceId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ id: nanoid(), hqUserId: actor.hqUserId, sessionId: actor.sessionId, allianceId, action, severity: "update", resourceType: "ocr_media", resourceId, metadata });
}

export async function loadMediaPolicy(allianceId: string) {
  const [row] = await getDb().select().from(schema.ocrMediaPolicies).where(eq(schema.ocrMediaPolicies.allianceId, allianceId)).limit(1);
  const policy = row ? ocrMediaPolicySchema.parse(row.policy) : disabledMediaPolicy;
  const bytes = await getDb().transaction((tx) => usage(tx, allianceId));
  return { policy, revision: row?.revision ?? 0, reservedBytes: bytes };
}

export async function saveMediaPolicy(allianceId: string, expectedRevision: number, policy: OcrMediaPolicy, actor: OcrActor) {
  const parsed = ocrMediaPolicySchema.safeParse(policy);
  if (!ocrIdSchema.safeParse(allianceId).success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !parsed.success) throw new OcrLearningError("invalid_policy");
  return getDb().transaction(async (tx) => {
    await lockMedia(tx, allianceId);
    const [alliance] = await tx.select({ id: schema.alliances.id }).from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
    if (!alliance) throw new OcrLearningError("alliance_not_found", 404);
    const [previous] = await tx.select().from(schema.ocrMediaPolicies).where(eq(schema.ocrMediaPolicies.allianceId, allianceId)).limit(1);
    if ((previous?.revision ?? 0) !== expectedRevision) throw new OcrLearningError("stale_policy", 409);
    const revision = expectedRevision + 1;
    await tx.insert(schema.ocrMediaPolicies).values({ allianceId, revision, policy: parsed.data, updatedByHqUserId: actor.hqUserId }).onConflictDoUpdate({ target: schema.ocrMediaPolicies.allianceId, set: { revision, policy: parsed.data, updatedByHqUserId: actor.hqUserId, updatedAt: new Date() } });
    await auditMedia(tx, actor, allianceId, "ocr.media.policy", allianceId, { revision, previous: previous?.policy ?? disabledMediaPolicy, next: parsed.data });
    return { policy: parsed.data, revision, reservedBytes: await usage(tx, allianceId) };
  });
}

export async function createMediaUpload(input: OcrMediaUpload, actor: OcrActor) {
  const parsed = mediaUploadSchema.safeParse(input);
  if (!parsed.success) throw new OcrLearningError("invalid_media");
  return getDb().transaction(async (tx) => {
    await lockMedia(tx, input.allianceId);
    const digest = ocrContentHash(parsed.data);
    const [existing] = await tx.select().from(schema.ocrMediaTasks).where(and(eq(schema.ocrMediaTasks.allianceId, input.allianceId), eq(schema.ocrMediaTasks.requestId, input.requestId))).limit(1);
    if (existing) {
      if (existing.requestHash !== digest || existing.createdByHqUserId !== actor.hqUserId) throw new OcrLearningError("media_request_conflict", 409);
      return existing;
    }
    const [storedPolicy] = await tx.select().from(schema.ocrMediaPolicies).where(eq(schema.ocrMediaPolicies.allianceId, input.allianceId)).limit(1);
    const policy = ocrMediaPolicySchema.parse(storedPolicy?.policy ?? disabledMediaPolicy);
    if (!storedPolicy || !policy.enabled || !policy.dataPermissionApproved) throw new OcrLearningError("media_collection_disabled", 409);
    if (input.bytes > policy.sourceLimitBytes || await usage(tx, input.allianceId) + input.bytes * 2 > policy.storageBudgetBytes) throw new OcrLearningError("media_budget_exhausted", 409);
    const id = nanoid(), extension = mediaExtension(input.contentType);
    const stagingKey = `ocr-staging/${input.allianceId}/${id}/source${extension}`;
    const sourceKey = `ocr-learning/${input.allianceId}/${id}/${nanoid()}${extension}`;
    const expiresAt = new Date(Date.now() + policy.retentionDays * 86400000);
    const [task] = await tx.insert(schema.ocrMediaTasks).values({ id, allianceId: input.allianceId, scoreTarget: input.scoreTarget, requestId: input.requestId, requestHash: digest, fileName: input.fileName, contentType: input.contentType, expectedBytes: input.bytes, expectedSha256: input.sha256, stagingKey, sourceKey, policyRevision: storedPolicy.revision, policySnapshot: policy, expiresAt, createdByHqUserId: actor.hqUserId }).returning();
    await tx.insert(schema.ocrMediaObjects).values([
      { storageKey: stagingKey, taskId: id, allianceId: input.allianceId, kind: "staging", reservedBytes: input.bytes, deleteAfter: new Date(Date.now() + 86400000) },
      { storageKey: sourceKey, taskId: id, allianceId: input.allianceId, kind: "source", reservedBytes: input.bytes, sha256: input.sha256, deleteAfter: expiresAt },
    ]);
    await auditMedia(tx, actor, input.allianceId, "ocr.media.request", id, { sourceBytes: input.bytes, scoreTarget: input.scoreTarget, expiresAt: expiresAt.toISOString() });
    return task;
  });
}

export async function loadMediaTask(allianceId: string, id: string) {
  const [task] = await getDb().select().from(schema.ocrMediaTasks).where(and(eq(schema.ocrMediaTasks.id, id), eq(schema.ocrMediaTasks.allianceId, allianceId))).limit(1);
  if (!task) throw new OcrLearningError("media_not_found", 404);
  return task;
}

export async function enqueueMediaTask(allianceId: string, id: string, actor: OcrActor) {
  return getDb().transaction(async (tx) => {
    await lockMedia(tx, allianceId);
    const [task] = await tx.select().from(schema.ocrMediaTasks).where(and(eq(schema.ocrMediaTasks.id, id), eq(schema.ocrMediaTasks.allianceId, allianceId))).limit(1).for("update");
    if (!task) throw new OcrLearningError("media_not_found", 404);
    if (task.createdByHqUserId !== actor.hqUserId) throw new OcrLearningError("forbidden", 403);
    if (task.state === "revoked" || task.expiresAt <= new Date()) throw new OcrLearningError("media_expired", 409);
    if (task.state === "uploading" || task.state === "failed") {
      const [current] = await tx.select().from(schema.ocrMediaPolicies).where(eq(schema.ocrMediaPolicies.allianceId, allianceId)).limit(1);
      if (!current?.policy.enabled || !current.policy.dataPermissionApproved || task.expectedBytes > current.policy.sourceLimitBytes) throw new OcrLearningError("media_policy_changed", 409);
      const expiresAt = new Date(Math.min(task.expiresAt.getTime(), Date.now() + current.policy.retentionDays * 86400000));
      await tx.update(schema.ocrMediaTasks).set({ state: "queued", errorCode: null, policyRevision: current.revision, policySnapshot: current.policy, expiresAt, updatedAt: new Date() }).where(eq(schema.ocrMediaTasks.id, id));
      await tx.update(schema.ocrMediaObjects).set({ deleteAfter: sql`least(${schema.ocrMediaObjects.deleteAfter}, ${expiresAt.toISOString()}::timestamptz)` }).where(eq(schema.ocrMediaObjects.taskId, id));
      await auditMedia(tx, actor, allianceId, "ocr.media.enqueue", id, { policyRevision: current.revision });
    }
    return { id, state: task.state === "uploading" || task.state === "failed" ? "queued" : task.state };
  });
}

export async function claimMediaTask(id: string) {
  const [peek] = await getDb().select({ allianceId: schema.ocrMediaTasks.allianceId }).from(schema.ocrMediaTasks).where(eq(schema.ocrMediaTasks.id, id)).limit(1);
  if (!peek) throw new OcrLearningError("media_not_found", 404);
  const result = await getDb().transaction(async (tx) => {
    await lockMedia(tx, peek.allianceId);
    const [task] = await tx.select().from(schema.ocrMediaTasks).where(eq(schema.ocrMediaTasks.id, id)).limit(1).for("update");
    if (task.state === "ready") return null;
    if (task.state !== "queued" && !(task.state === "running" && task.leaseExpiresAt && task.leaseExpiresAt <= new Date())) throw new OcrLearningError("media_not_queued", 409);
    if (task.expiresAt <= new Date() || task.attempts >= 3) {
      await tx.update(schema.ocrMediaTasks).set({ state: "failed", errorCode: "media_expired", leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.ocrMediaTasks.id, id));
      return { blockedCode: "media_expired" };
    }
    const [policy] = await tx.select().from(schema.ocrMediaPolicies).where(eq(schema.ocrMediaPolicies.allianceId, task.allianceId)).limit(1);
    const [actor] = task.createdByHqUserId ? await tx.select({ maintainer: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, task.createdByHqUserId)).limit(1) : [];
    if (!policy?.policy.enabled || !policy.policy.dataPermissionApproved || policy.revision !== task.policyRevision || !actor?.maintainer) {
      await tx.update(schema.ocrMediaTasks).set({ state: "failed", errorCode: "media_policy_changed", leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.ocrMediaTasks.id, id));
      return { blockedCode: "media_policy_changed" };
    }
    let sourceKey = task.sourceKey;
    const [source] = await tx.select().from(schema.ocrMediaObjects).where(eq(schema.ocrMediaObjects.storageKey, sourceKey)).limit(1);
    if (task.attempts > 0 && source?.state !== "ready") {
      if (await usage(tx, task.allianceId) + task.expectedBytes > policy.policy.storageBudgetBytes) throw new OcrLearningError("media_budget_exhausted", 409);
      sourceKey = `ocr-learning/${task.allianceId}/${id}/${nanoid()}${mediaExtension(task.contentType)}`;
      await tx.insert(schema.ocrMediaObjects).values({ storageKey: sourceKey, taskId: id, allianceId: task.allianceId, kind: "source", reservedBytes: task.expectedBytes, sha256: task.expectedSha256, deleteAfter: task.expiresAt });
    }
    const leaseToken = nanoid();
    const [claimed] = await tx.update(schema.ocrMediaTasks).set({ state: "running", sourceKey, leaseToken, leaseExpiresAt: new Date(Date.now() + 5 * 60000), attempts: task.attempts + 1, errorCode: null, updatedAt: new Date() }).where(eq(schema.ocrMediaTasks.id, id)).returning();
    return claimed;
  });
  if (result && "blockedCode" in result) throw new OcrLearningError(result.blockedCode, 409);
  return result;
}

async function leasedMediaTask(tx: OcrTransaction, taskId: string, leaseToken: string) {
  const [task] = await tx.select().from(schema.ocrMediaTasks).where(eq(schema.ocrMediaTasks.id, taskId)).limit(1);
  if (!task) throw new OcrLearningError("media_not_found", 404);
  await lockMedia(tx, task.allianceId);
  const [current] = await tx.select().from(schema.ocrMediaTasks).where(eq(schema.ocrMediaTasks.id, taskId)).limit(1).for("update");
  const [policy] = await tx.select().from(schema.ocrMediaPolicies).where(eq(schema.ocrMediaPolicies.allianceId, task.allianceId)).limit(1);
  const [actor] = current.createdByHqUserId ? await tx.select({ maintainer: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, current.createdByHqUserId)).limit(1) : [];
  if (current.state !== "running" || current.leaseToken !== leaseToken || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date() || current.expiresAt <= new Date() || !policy?.policy.enabled || !policy.policy.dataPermissionApproved || policy.revision !== current.policyRevision || !actor?.maintainer) throw new OcrLearningError("stale_media_lease", 409);
  return { task: current, policy: policy.policy };
}

export async function reserveMediaFrame(taskId: string, leaseToken: string, bytes: number, sha256: string) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 20 * 1024 ** 2 || !ocrHashSchema.safeParse(sha256).success) throw new OcrLearningError("invalid_media");
  return getDb().transaction(async (tx) => {
    const { task, policy } = await leasedMediaTask(tx, taskId, leaseToken);
    if (await usage(tx, task.allianceId) + bytes > policy.storageBudgetBytes) throw new OcrLearningError("media_budget_exhausted", 409);
    const prefix = `ocr-learning/${task.allianceId}/${taskId}/attempt-${task.attempts}/`;
    const [count] = await tx.select({ count: sql<number>`count(*)::integer` }).from(schema.ocrMediaObjects).where(and(eq(schema.ocrMediaObjects.taskId, taskId), eq(schema.ocrMediaObjects.kind, "frame"), sql`${schema.ocrMediaObjects.storageKey} like ${`${prefix}%`}`));
    if (count.count >= policy.maxFrames) throw new OcrLearningError("media_frame_limit", 409);
    const storageKey = `${prefix}${nanoid()}.png`;
    await tx.insert(schema.ocrMediaObjects).values({ storageKey, taskId, allianceId: task.allianceId, kind: "frame", reservedBytes: bytes, sha256, deleteAfter: task.expiresAt });
    return storageKey;
  });
}

export async function markMediaObjectReady(taskId: string, leaseToken: string, storageKey: string, sha256: string, bytes: number) {
  return getDb().transaction(async (tx) => {
    const { task } = await leasedMediaTask(tx, taskId, leaseToken);
    const [object] = await tx.select().from(schema.ocrMediaObjects).where(and(eq(schema.ocrMediaObjects.storageKey, storageKey), eq(schema.ocrMediaObjects.taskId, taskId))).limit(1);
    if (!object || object.state === "deleted" || object.reservedBytes !== bytes || object.sha256 !== sha256 || object.allianceId !== task.allianceId || object.kind === "source" && storageKey !== task.sourceKey) throw new OcrLearningError("media_object_mismatch", 409);
    await tx.update(schema.ocrMediaObjects).set({ state: "ready", updatedAt: new Date() }).where(eq(schema.ocrMediaObjects.storageKey, storageKey));
  });
}

export async function completeMediaTask(taskId: string, leaseToken: string, sample: OcrCase) {
  return getDb().transaction(async (tx) => {
    const { task, policy } = await leasedMediaTask(tx, taskId, leaseToken);
    if (sample.id !== taskId || sample.allianceId !== task.allianceId || sample.scoreTarget !== task.scoreTarget || sample.sourceSha256 !== task.expectedSha256 || new Date(sample.expiresAt).getTime() !== task.expiresAt.getTime() || !sample.frames.length || sample.frames.length > policy.maxFrames) throw new OcrLearningError("invalid_case");
    const objects = await tx.select().from(schema.ocrMediaObjects).where(and(eq(schema.ocrMediaObjects.taskId, taskId), eq(schema.ocrMediaObjects.state, "ready")));
    const byKey = new Map(objects.map((object) => [object.storageKey, object]));
    if (byKey.get(task.sourceKey)?.sha256 !== task.expectedSha256 || sample.frames.some((frame) => byKey.get(frame.storageKey)?.sha256 !== frame.sha256)) throw new OcrLearningError("media_object_mismatch", 409);
    const actor = { hqUserId: task.createdByHqUserId! };
    const result = await createCandidateCase({ sample, sourceStorageKey: task.sourceKey, sourceBytes: task.expectedBytes, fileName: task.fileName }, actor, tx);
    await tx.update(schema.ocrMediaTasks).set({ state: "ready", leaseToken: null, leaseExpiresAt: null, errorCode: null, updatedAt: new Date() }).where(eq(schema.ocrMediaTasks.id, taskId));
    await auditMedia(tx, actor, task.allianceId, "ocr.media.seal", taskId, { frameCount: sample.frames.length, sourceSha256: task.expectedSha256 });
    return result;
  });
}

export async function failMediaTask(taskId: string, leaseToken: string, errorCode: string) {
  const safeCode = /^[a-z_]{1,64}$/.test(errorCode) ? errorCode : "media_processing_failed";
  await getDb().update(schema.ocrMediaTasks).set({ state: "failed", errorCode: safeCode, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(schema.ocrMediaTasks.id, taskId), eq(schema.ocrMediaTasks.leaseToken, leaseToken), eq(schema.ocrMediaTasks.state, "running")));
}
