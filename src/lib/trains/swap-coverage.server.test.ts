import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), updates: vi.fn(), inserts: vi.fn(), lock: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/time-off/availability.server", () => ({ lockAllianceAvailability: mocks.lock }));
vi.mock("@/lib/time-off/coverage.server", async (original) => ({ ...await original<object>(), assertDutyCoverage: mocks.guard }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const tx = {
    select: () => ({ from: (table: unknown) => {
      const result = table === schema.trainConductorRecords ? mocks.snapshot() : [];
      const chain = { where: () => chain, orderBy: () => chain, for: async () => result, limit: async () => result, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
      return chain;
    } }),
    update: (table: unknown) => ({ set: (patch: unknown) => ({ where: async () => { mocks.updates(table, patch); } }) }),
    insert: (table: unknown) => ({ values: async (patch: unknown) => { mocks.inserts(table, patch); } }),
  };
  return { schema, getDb: () => ({ transaction: (work: (db: typeof tx) => unknown) => work(tx) }) };
});
import { swapConductorDrafts } from "./swap-coverage.server";

const input = { allianceId: "alliance", dateA: "2099-06-10", dateB: "2099-06-12" };
const row = { id: "source", allianceId: "alliance", date: input.dateA, conductorMemberId: "m1", conductorMemberName: "Alice", vipMemberId: "v1", vipMemberName: "VIP", lockedAt: null };

describe("atomic conductor swaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue(undefined);
    mocks.snapshot.mockReturnValue([{ row, version: "1" }]);
  });
  it("clears the orphan source VIP and its pool claim without releasing the conductor", async () => {
    await swapConductorDrafts(input);
    expect(mocks.updates).toHaveBeenCalledWith(schema.trainConductorRecords, expect.objectContaining({ conductorMemberId: null, vipMemberId: null }));
    expect(mocks.updates).toHaveBeenCalledWith(schema.conductorPoolEntries, { selectedAt: null, selectedForDate: null });
    expect(mocks.updates).toHaveBeenCalledWith(schema.conductorPoolEntries, { selectedForDate: input.dateB });
    expect(mocks.inserts).toHaveBeenCalledWith(schema.trainConductorRecords, expect.objectContaining({ conductorMemberId: "m1", date: input.dateB }));
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.snapshot.mock.invocationCallOrder[0]!);
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.updates.mock.invocationCallOrder[0]!);
  });
  it("does not release a VIP pool claim when source has no VIP", async () => {
    mocks.snapshot.mockReturnValue([{ row: { ...row, vipMemberId: null }, version: "1" }]);
    await swapConductorDrafts(input);
    expect(mocks.updates).not.toHaveBeenCalledWith(schema.conductorPoolEntries, { selectedAt: null, selectedForDate: null });
  });
  it("preserves both locks and assignments when a day is locked", async () => {
    mocks.snapshot.mockReturnValue([{ row: { ...row, lockedAt: new Date() }, version: "1" }]);
    await expect(swapConductorDrafts(input)).rejects.toThrow("Unlock");
    expect(mocks.updates).not.toHaveBeenCalled();
    expect(mocks.inserts).not.toHaveBeenCalled();
  });
  it("checks the destination absence before changing either day or pool", async () => {
    mocks.guard.mockRejectedValue(new Error("coverage_conflict"));
    await expect(swapConductorDrafts(input)).rejects.toThrow("coverage_conflict");
    expect(mocks.guard).toHaveBeenCalledWith(expect.anything(), "alliance", [expect.objectContaining({ memberId: "m1", dutyDate: input.dateB, assignmentVersion: "unassigned" })]);
    expect(mocks.updates).not.toHaveBeenCalled();
    expect(mocks.inserts).not.toHaveBeenCalled();
  });
});
