import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { CoverageConflictError, withCoverageActor } from "@/lib/time-off/coverage.server";

const mocks = vi.hoisted(() => ({ row: {} as Record<string, unknown>, notices: [] as Array<{ id: string; version: number }>, writes: vi.fn(), sequence: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const tx = {
    execute: async () => { mocks.sequence.push("availability-lock"); },
    select: (selection?: Record<string, unknown>) => ({ from: (table: unknown) => {
      mocks.sequence.push(table === schema.memberTimeOff ? "absence-read" : "assignment-read");
      const result = table === schema.memberTimeOff ? mocks.notices : table === schema.trainConductorRecords ? selection?.row ? [{ row: mocks.row, version: "1" }] : [mocks.row] : [];
      const chain = { where: () => chain, limit: () => chain, for: async () => result, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
      return chain;
    } }),
    update: (table: unknown) => ({ set: (patch: unknown) => { mocks.sequence.push("write"); mocks.writes(table, patch); const chain = { where: () => chain, returning: async () => [{ id: "claimed" }], then: (resolve: () => unknown) => Promise.resolve().then(resolve) }; return chain; } }),
    insert: (table: unknown) => ({ values: (patch: unknown) => { mocks.sequence.push("write"); mocks.writes(table, patch); return { onConflictDoNothing: async () => undefined }; } }),
  };
  return { schema, getDb: () => ({ transaction: (work: (db: typeof tx) => unknown) => work(tx) }) };
});
import { assignVipOnLockedConductor, lockConductorRecord, upsertConductorDraft } from "./repository";

const input = { allianceId: "alliance", date: "2099-09-10", conductorMemberId: "member", conductorMemberName: "Commander", poolClaim: "r3" };

beforeEach(() => {
  mocks.row = { id: "draft", allianceId: "alliance", date: input.date, conductorMemberId: "member", conductorMemberName: "Commander", vipMemberId: null, vipMemberName: null, lockedAt: null };
  mocks.notices = [{ id: "absence", version: 1 }];
  mocks.writes.mockClear();
  mocks.sequence.length = 0;
});

for (const path of ["draft", "vip", "lock"] as const) describe(`transaction-bound ${path} assignment`, () => {
  const run = () => path === "draft" ? upsertConductorDraft(input) : path === "vip" ? assignVipOnLockedConductor({ allianceId: "alliance", date: input.date, vipMemberId: "member", vipMemberName: "Commander" }) : lockConductorRecord("draft", "alliance", "officer");
  beforeEach(() => { if (path === "vip") mocks.row.lockedAt = new Date("2099-09-09T12:00:00Z"); });
  it("rejects an away assignment before any draft, pool, lock or spawn write", async () => {
    await expect(run()).rejects.toBeInstanceOf(CoverageConflictError);
    expect(mocks.writes).not.toHaveBeenCalled();
    expect(mocks.sequence[0]).toBe("availability-lock");
    expect(mocks.sequence).toContain("absence-read");
  });
  it("allows explicit current coverage acceptance and writes an actor-bound audit", async () => {
    const error = await run().catch((error) => error);
    expect(error).toBeInstanceOf(CoverageConflictError);
    await withCoverageActor({ allianceId: "alliance", hqUserId: "officer", acceptance: { conflicts: error.conflicts, note: "Confirmed coverage", requestId: "request_1234567890" } }, run);
    expect(mocks.writes).toHaveBeenCalledWith(schema.auditLog, expect.objectContaining({ hqUserId: "officer", action: "time_off.coverage_keep" }));
    expect(mocks.writes).toHaveBeenCalledWith(schema.trainConductorRecords, expect.anything());
    if (path === "draft") expect(mocks.writes).toHaveBeenCalledWith(schema.conductorPoolEntries, expect.objectContaining({ selectedForDate: input.date }));
    if (path === "vip") expect(mocks.row.lockedAt).not.toBeNull();
    if (path === "lock") expect(mocks.writes).toHaveBeenCalledWith(schema.trains, expect.anything());
  });
  it("rejects stale acceptance after absence revision without writing", async () => {
    const error = await run().catch((error) => error);
    mocks.notices[0]!.version++;
    await expect(withCoverageActor({ allianceId: "alliance", hqUserId: "officer", acceptance: { conflicts: error.conflicts, note: "Confirmed coverage", requestId: "request_1234567890" } }, run)).rejects.toBeInstanceOf(CoverageConflictError);
    expect(mocks.writes).not.toHaveBeenCalled();
  });
});
