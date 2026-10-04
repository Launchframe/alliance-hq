import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { ExcusedRecord } from "./excused-sync.shared";

const upstream = vi.hoisted(() => ({
  records: new Map<string, ExcusedRecord>(),
  contexts: new Map<string, { allianceId: string; appId: string; connection: { token: string; appId: string; originUrl: string } }>(),
  create: vi.fn(), delete: vi.fn(), snapshot: vi.fn(), validateMember: vi.fn(),
}));
vi.mock("./excused-transport.server", () => ({
  resolveExcusedConnection: (id: string) => upstream.contexts.get(id) ?? null,
  fetchExcusedSnapshot: (...args: unknown[]) => upstream.snapshot(...args),
  fetchExcusedRecord: (context: { allianceId: string }, id: string, memberId: string) => {
    const record = upstream.records.get(id);
    if (record && (record.allianceId !== context.allianceId || record.memberId !== memberId)) throw new Error("scope_mismatch");
    return record ?? null;
  },
  validateExcusedMember: (...args: unknown[]) => upstream.validateMember(...args),
  createExcusedRecord: (...args: unknown[]) => upstream.create(...args),
  deleteExcusedRecord: (...args: unknown[]) => upstream.delete(...args),
}));

import { createAllianceRosterMember, createAshedAlliance, createAuthenticatedHqSession, getE2eSql, closeE2eSql } from "../../../e2e/fixtures/db";
import { getSqlClient } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { createTimeOff, cancelTimeOff } from "./mutations.server";
import { applyExcusedAction, loadExcusedReview } from "./excused-actions.server";
import { ExcusedSyncError, type DesiredExcusedRecord } from "./excused-sync.shared";
import { syncAllianceExcuses } from "./excused-worker.server";
import { loadTimeOffAvailability } from "./availability.server";

async function setup() {
  const sql = getE2eSql();
  const alliance = await createAshedAlliance(sql, { tag: `SY${nanoid(6)}`, name: "Sync Test Alliance" });
  const externalId = `external-${alliance.allianceId}`;
  await sql`UPDATE alliances SET ashed_alliance_id = ${externalId} WHERE id = ${alliance.allianceId}`;
  const user = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
  const member = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Sync Commander" });
  upstream.contexts.set(alliance.allianceId, { allianceId: externalId, appId: "test-app", connection: { token: "test-only", appId: "test-app", originUrl: "https://ashed.online" } });
  const actor = { allianceId: alliance.allianceId, hqUserId: user.hqUserId, canManageOthers: true, ownedCommanderIds: [member.ashedMemberId], locale: "en-US" };
  const startDate = addCalendarDays(getServerCalendarDate(), 1);
  const draft = { ashedMemberId: member.ashedMemberId, startDate, endDate: addCalendarDays(startDate, 2), notes: "PRIVATE_HQ_NOTE" };
  const tick = async () => {
    await sql`UPDATE time_off_sync_state SET next_poll_at = now() - interval '1 second' WHERE alliance_id = ${alliance.allianceId}`;
    const result = await syncAllianceExcuses(alliance.allianceId, { maxJobs: 20 });
    expect(result).not.toHaveProperty("error");
    return result;
  };
  return { sql, ...alliance, externalId, actor, draft, tick };
}

beforeEach(() => {
  vi.clearAllMocks();
  upstream.records.clear(); upstream.contexts.clear();
  upstream.validateMember.mockResolvedValue(undefined);
  upstream.snapshot.mockImplementation((context: { allianceId: string }) => [...upstream.records.values()].filter((record) => record.allianceId === context.allianceId));
  upstream.create.mockImplementation((_context: unknown, desired: DesiredExcusedRecord) => {
    const id = nanoid();
    upstream.records.set(id, { ...desired, id, changedAt: new Date().toISOString() });
    return id;
  });
  upstream.delete.mockImplementation((_context: unknown, id: string) => { upstream.records.delete(id); });
});

describe.skipIf(process.env.TIME_OFF_SYNC_DB_TEST !== "1")("Ashed sync with real e2e DB and mocked transport", () => {
  afterAll(async () => { await closeE2eSql(); await getSqlClient().end({ timeout: 5 }); });

  it("persists both outbox intents atomically, syncs once and never exports private notes", async () => {
    const f = await setup();
    const entry = await createTimeOff(f.actor, f.draft, randomUUID());
    expect(entry.syncStatus).toBe("pending");
    const jobs = await f.sql`SELECT desired FROM time_off_sync_jobs WHERE alliance_id = ${f.allianceId}`;
    expect(jobs).toHaveLength(2);
    expect(JSON.stringify(jobs)).not.toContain(f.draft.notes);
    await f.tick(); await f.tick();
    expect(upstream.create).toHaveBeenCalledTimes(2);
    const rows = await f.sql`SELECT sync_status FROM member_time_off WHERE id = ${entry.id}`;
    expect(rows[0].sync_status).toBe("synced");
  }, 20000);

  it("keeps the successful half of a create and resolves a lost response without reposting", async () => {
    const f = await setup();
    const normal = upstream.create.getMockImplementation()!;
    upstream.create.mockImplementation((context, desired: DesiredExcusedRecord) => {
      const id = normal(context, desired);
      if (desired.recordType === "donation") throw new ExcusedSyncError("uncertain");
      return id;
    });
    const entry = await createTimeOff(f.actor, f.draft, randomUUID());
    await f.tick(); await f.tick();
    expect(upstream.create).toHaveBeenCalledTimes(2);
    const review = await loadExcusedReview(f.actor, entry.id);
    const uncertain = review.bindings.find((binding) => binding.recordType === "donation")!;
    expect(uncertain.status).toBe("uncertain");
    expect(uncertain.candidates).toHaveLength(1);
    const candidate = uncertain.candidates[0];
    await applyExcusedAction(f.actor, entry.id, { action: "link_existing", version: review.version, bindingId: uncertain.id, fingerprint: uncertain.fingerprint, remoteId: candidate.id, candidateFingerprint: candidate.fingerprint });
    await f.tick();
    expect(upstream.create).toHaveBeenCalledTimes(2);
    expect((await f.sql`SELECT id FROM member_time_off WHERE alliance_id = ${f.allianceId}`)).toHaveLength(1);
    expect((await f.sql`SELECT remote_id FROM time_off_sync_bindings WHERE entry_id = ${entry.id}`).map((row) => row.remote_id)).not.toContain(null);
  }, 20000);

  it("recovers deletion after a lost response and tombstones prevent resurrection", async () => {
    const f = await setup();
    const entry = await createTimeOff(f.actor, f.draft, randomUUID());
    await f.tick();
    const stale = [...upstream.records.values()];
    const normal = upstream.delete.getMockImplementation()!;
    upstream.delete.mockImplementationOnce((context, id) => { normal(context, id); throw new ExcusedSyncError("failed"); });
    await cancelTimeOff(f.actor, entry.id, entry.version);
    await f.tick(); await f.tick();
    expect(upstream.records.size).toBe(0);
    expect((await f.sql`SELECT id FROM time_off_sync_tombstones WHERE alliance_id = ${f.allianceId}`)).toHaveLength(2);
    upstream.snapshot.mockResolvedValue(stale);
    await f.tick();
    expect((await f.sql`SELECT id FROM member_time_off WHERE alliance_id = ${f.allianceId} AND cancelled_at IS NULL`)).toHaveLength(0);
  }, 20000);

  it("imports, splits, merges and removes paired Ashed periods without overwriting mappings", async () => {
    const f = await setup();
    const base = { allianceId: f.externalId, memberId: f.draft.ashedMemberId, startDate: f.draft.startDate, endDate: f.draft.endDate, reason: "Ashed reason", changedAt: new Date(Date.now() - 60_000).toISOString() };
    upstream.records.set("vs-a", { ...base, id: "vs-a", recordType: "vs" });
    upstream.records.set("donation-a", { ...base, id: "donation-a", recordType: "donation" });
    await f.tick();
    const active = () => f.sql`SELECT id, activity_scope, global_absence FROM member_time_off WHERE alliance_id = ${f.allianceId} AND cancelled_at IS NULL`;
    expect(await active()).toMatchObject([{ activity_scope: "all", global_absence: true }]);
    const changedEnd = addCalendarDays(base.endDate, 1);
    upstream.records.set("vs-a", { ...upstream.records.get("vs-a")!, endDate: changedEnd });
    await f.tick();
    expect((await active()).map((row) => row.activity_scope).sort()).toEqual(["donation", "vs"]);
    upstream.records.set("donation-a", { ...upstream.records.get("donation-a")!, endDate: changedEnd });
    await f.tick();
    expect(await active()).toMatchObject([{ activity_scope: "all", global_absence: true }]);
    upstream.records.clear();
    await f.tick();
    expect(await active()).toHaveLength(0);
    expect(upstream.create).not.toHaveBeenCalled();
  }, 20000);

  it("adopts external changes without losing private HQ explanations", async () => {
    const f = await setup();
    const entry = await createTimeOff(f.actor, f.draft, randomUUID());
    await f.tick();
    const vs = [...upstream.records.values()].find((record) => record.recordType === "vs")!;
    upstream.records.set(vs.id, { ...vs, endDate: addCalendarDays(vs.endDate, 1) });
    await f.tick();
    const review = await loadExcusedReview(f.actor, entry.id);
    const binding = review.bindings.find((row) => row.recordType === "vs")!;
    expect(binding.status).toBe("conflict");
    await applyExcusedAction(f.actor, entry.id, { action: "use_ashed", version: review.version, bindingId: binding.id, fingerprint: binding.fingerprint });
    await f.tick();
    const active = await f.sql`SELECT notes, private_notes_owned FROM member_time_off WHERE alliance_id = ${f.allianceId} AND cancelled_at IS NULL`;
    expect(active).toHaveLength(2);
    expect(active.every((row) => row.notes === f.draft.notes && row.private_notes_owned)).toBe(true);
    const bindings = await f.sql`SELECT record_type, origin FROM time_off_sync_bindings WHERE alliance_id = ${f.allianceId}`;
    expect(bindings.find((row) => row.record_type === "vs")?.origin).toBe("ashed");
    expect(bindings.find((row) => row.record_type === "donation")?.origin).toBe("hq");
    expect(upstream.create).toHaveBeenCalledTimes(2);
    expect(upstream.delete).not.toHaveBeenCalled();
  }, 20000);

  it("preserves an early VS excuse without backdating a later paired donation excuse", async () => {
    const f = await setup();
    const date = "2026-09-01";
    const base = { allianceId: f.externalId, memberId: f.draft.ashedMemberId, startDate: date, endDate: date, reason: "Same period" };
    upstream.records.set("early-vs", { ...base, id: "early-vs", recordType: "vs", changedAt: `${date}T01:00:00.000Z` });
    upstream.records.set("late-donation", { ...base, id: "late-donation", recordType: "donation", changedAt: `${date}T03:00:00.000Z` });
    await f.tick();
    expect((await loadTimeOffAvailability(f.allianceId, date, "vs")).excusedMemberIds.has(f.draft.ashedMemberId)).toBe(true);
    expect((await loadTimeOffAvailability(f.allianceId, date, "donation")).excusedMemberIds.has(f.draft.ashedMemberId)).toBe(false);
    expect((await loadTimeOffAvailability(f.allianceId, date)).excusedMemberIds.has(f.draft.ashedMemberId)).toBe(false);
  }, 20000);

  it("serializes concurrent workers with one alliance lease", async () => {
    const f = await setup();
    await createTimeOff(f.actor, f.draft, randomUUID());
    const normal = upstream.snapshot.getMockImplementation()!;
    upstream.snapshot.mockImplementation(async (context) => { await new Promise((resolve) => setTimeout(resolve, 40)); return normal(context); });
    const results = await Promise.all([syncAllianceExcuses(f.allianceId), syncAllianceExcuses(f.allianceId)]);
    expect(results.filter((result) => "skipped" in result && result.skipped)).toHaveLength(1);
    expect(upstream.create).toHaveBeenCalledTimes(2);
  }, 20000);

  it("preserves a cancellation that arrives while an upstream create is in flight", async () => {
    const f = await setup();
    const entry = await createTimeOff(f.actor, f.draft, randomUUID());
    const normal = upstream.create.getMockImplementation()!;
    let cancelled = false;
    upstream.create.mockImplementation(async (context, desired) => {
      if (!cancelled) { cancelled = true; await cancelTimeOff(f.actor, entry.id, entry.version); }
      return normal(context, desired);
    });
    await f.tick(); await f.tick();
    expect(upstream.records.size).toBe(0);
    expect((await f.sql`SELECT cancelled_at FROM member_time_off WHERE id = ${entry.id}`)[0].cancelled_at).not.toBeNull();
    expect(upstream.create).toHaveBeenCalledTimes(1);
  }, 20000);

  it("does not rebind an imported period when Ashed changes its member", async () => {
    const f = await setup();
    const other = await createAllianceRosterMember(f.sql, { allianceId: f.allianceId, currentName: "Other Commander" });
    upstream.records.set("period-a", { id: "period-a", allianceId: f.externalId, memberId: f.draft.ashedMemberId, recordType: "vs", startDate: f.draft.startDate, endDate: f.draft.endDate, reason: "Original note", changedAt: new Date().toISOString() });
    await f.tick();
    upstream.records.set("period-a", { ...upstream.records.get("period-a")!, memberId: other.ashedMemberId, reason: "OTHER_PRIVATE_NOTE" });
    await f.tick();
    const rows = await f.sql`SELECT ashed_member_id, notes, sync_status FROM member_time_off WHERE alliance_id = ${f.allianceId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ashed_member_id: f.draft.ashedMemberId, notes: "Original note", sync_status: "conflict" });
  }, 20000);

  it("rejects an incomplete snapshot without cancelling recorded absences", async () => {
    const f = await setup();
    const entry = await createTimeOff(f.actor, f.draft, randomUUID());
    await f.tick();
    upstream.snapshot.mockRejectedValue(new ExcusedSyncError("invalid_snapshot"));
    await f.sql`UPDATE time_off_sync_state SET next_poll_at = now() - interval '1 second' WHERE alliance_id = ${f.allianceId}`;
    expect(await syncAllianceExcuses(f.allianceId)).toMatchObject({ error: "invalid_snapshot" });
    const [row] = await f.sql`SELECT cancelled_at, notes FROM member_time_off WHERE id = ${entry.id}`;
    expect(row.cancelled_at).toBeNull(); expect(row.notes).toBe(f.draft.notes);
  }, 20000);
});
