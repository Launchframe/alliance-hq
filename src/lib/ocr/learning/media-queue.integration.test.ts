import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { assertE2eDatabaseUrl } from "../../../../scripts/e2e-database-url-guard.mjs";
import { createNativeAlliance, createPlatformMaintainerSession, getE2eSql, closeE2eSql } from "../../../../e2e/fixtures/db";
import { getDb, getSqlClient, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { claimMediaTask, createMediaUpload, enqueueMediaTask, loadMediaPolicy, reserveMediaFrame, saveMediaPolicy } from "./media-queue.server";
import { disabledMediaPolicy } from "./media.shared";

let used = false;
async function fixture() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== process.env.E2E_DATABASE_URL?.trim()) throw new Error("test_database_mismatch");
  used = true;
  const user = await createPlatformMaintainerSession(getE2eSql());
  const { allianceId } = await createNativeAlliance(getE2eSql(), { tag: `OM${nanoid(4)}`, name: "Media fixture" });
  const actor = { hqUserId: user.hqUserId, sessionId: user.sessionId };
  const policy = { ...disabledMediaPolicy, enabled: true, dataPermissionApproved: true, storageBudgetBytes: 1000, sourceLimitBytes: 500 };
  const input = { allianceId, scoreTarget: "vs-performance" as const, fileName: "source.mp4", contentType: "video/mp4" as const, bytes: 400, sha256: "a".repeat(64), requestId: nanoid() };
  return { allianceId, actor, policy, input };
}

describe.skipIf(process.env.OCR_LEARNING_DB_TEST !== "1")("bounded media collection", () => {
  afterAll(async () => { await closeE2eSql(); if (used) await getSqlClient().end({ timeout: 5 }); });

  it("starts disabled and makes reservation idempotent under concurrent requests", async () => {
    const f = await fixture();
    await expect(createMediaUpload(f.input, f.actor)).rejects.toMatchObject({ code: "media_collection_disabled" });
    await saveMediaPolicy(f.allianceId, 0, f.policy, f.actor);
    const [a, b] = await Promise.all([createMediaUpload(f.input, f.actor), createMediaUpload(f.input, f.actor)]);
    expect(a.id).toBe(b.id);
    expect((await loadMediaPolicy(f.allianceId)).reservedBytes).toBe(800);
    await expect(createMediaUpload({ ...f.input, requestId: nanoid() }, f.actor)).rejects.toMatchObject({ code: "media_budget_exhausted" });
    await expect(saveMediaPolicy(f.allianceId, 0, f.policy, f.actor)).rejects.toMatchObject({ code: "stale_policy" });
  });

  it("stops queued work when permission or policy revisions change", async () => {
    const f = await fixture();
    await saveMediaPolicy(f.allianceId, 0, f.policy, f.actor);
    const task = await createMediaUpload(f.input, f.actor);
    await enqueueMediaTask(f.allianceId, task.id, f.actor);
    await saveMediaPolicy(f.allianceId, 1, { ...f.policy, enabled: false }, f.actor);
    await expect(claimMediaTask(task.id)).rejects.toMatchObject({ code: "media_policy_changed" });
  });

  it("fences stale workers and continues charging uncertain earlier attempts", async () => {
    const f = await fixture();
    await saveMediaPolicy(f.allianceId, 0, { ...f.policy, storageBudgetBytes: 2000 }, f.actor);
    const task = await createMediaUpload(f.input, f.actor);
    await enqueueMediaTask(f.allianceId, task.id, f.actor);
    const first = (await claimMediaTask(task.id))!;
    await expect(claimMediaTask(task.id)).rejects.toMatchObject({ code: "media_not_queued" });
    await getDb().update(schema.ocrMediaTasks).set({ leaseExpiresAt: new Date(0) }).where(eq(schema.ocrMediaTasks.id, task.id));
    const second = (await claimMediaTask(task.id))!;
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(second.sourceKey).not.toBe(first.sourceKey);
    expect((await loadMediaPolicy(f.allianceId)).reservedBytes).toBe(1200);
    await expect(reserveMediaFrame(task.id, first.leaseToken!, 10, "b".repeat(64))).rejects.toMatchObject({ code: "stale_media_lease" });
    await reserveMediaFrame(task.id, second.leaseToken!, 10, "b".repeat(64));
    expect((await loadMediaPolicy(f.allianceId)).reservedBytes).toBe(1210);
  });
});
