import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  for: vi.fn(),
  delete: vi.fn(),
  deleteWhere: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
  lockAllianceAvailability: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    const tx = {
      select: mocks.select,
      delete: mocks.delete,
      update: mocks.update,
      rollback: () => {},
    };
    return {
      ...tx,
      transaction: mocks.transaction,
    };
  },
  schema: {
    trainConductorRecords: {
      id: "id",
      allianceId: "allianceId",
      lockedAt: "lockedAt",
    },
    trains: {
      conductorRecordId: "conductorRecordId",
    },
  },
}));

vi.mock("@/lib/trains/pool", () => ({
  releasePoolSelectionForDate: mocks.releasePoolSelectionForDate,
}));

vi.mock("@/lib/time-off/availability.server", () => ({
  lockAllianceAvailability: mocks.lockAllianceAvailability,
}));

import {
  ConductorUnlockForbiddenError,
  unlockConductorRecord,
} from "@/lib/trains/repository";

describe("unlockConductorRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          select: mocks.select,
          delete: mocks.delete,
          update: mocks.update,
          rollback: () => {},
        }),
    );
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ for: mocks.for });
    mocks.delete.mockReturnValue({ where: mocks.deleteWhere });
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.releasePoolSelectionForDate.mockResolvedValue(undefined);
    mocks.lockAllianceAvailability.mockResolvedValue(undefined);
  });

  it("CAS-unlocks then deletes trains under the alliance schedule lock", async () => {
    const locked = {
      id: "rec-1",
      allianceId: "ally-1",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      lockedAt: new Date("2026-06-10T12:00:00.000Z"),
    };
    const unlocked = { ...locked, lockedAt: null };
    const callOrder: string[] = [];
    mocks.lockAllianceAvailability.mockImplementation(async () => {
      callOrder.push("lock");
    });
    mocks.for.mockResolvedValueOnce([locked]);
    mocks.updateReturning.mockImplementation(async () => {
      callOrder.push("cas-unlock");
      return [unlocked];
    });
    mocks.deleteWhere.mockImplementation(async () => {
      callOrder.push("delete-trains");
    });

    const row = await unlockConductorRecord("rec-1", "ally-1");

    expect(row.lockedAt).toBeNull();
    expect(row.conductorMemberId).toBe("m1");
    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalled();
    expect(mocks.lockAllianceAvailability).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(["lock", "cas-unlock", "delete-trains"]);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedAt: null,
        lockedByHqUserId: null,
        discordDepartingSoonAt: null,
      }),
    );
  });

  it("refuses unlock when the row is already unlocked under FOR UPDATE", async () => {
    const unlocked = {
      id: "rec-1",
      allianceId: "ally-1",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      lockedAt: null,
    };
    mocks.for.mockResolvedValueOnce([unlocked]);

    await expect(unlockConductorRecord("rec-1", "ally-1")).rejects.toThrow(
      "Conductor is not locked.",
    );
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("checks ownership against the FOR UPDATE row before mutating", async () => {
    const locked = {
      id: "rec-1",
      allianceId: "ally-1",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      lockedAt: new Date("2026-06-10T12:00:00.000Z"),
      lockedByHqUserId: "officer-b",
    };
    const callOrder: string[] = [];
    mocks.lockAllianceAvailability.mockImplementation(async () => {
      callOrder.push("lock");
    });
    mocks.for.mockResolvedValueOnce([locked]);
    const authorize = vi.fn((row: { lockedByHqUserId: string | null }) => {
      callOrder.push("authorize");
      return row.lockedByHqUserId === "officer-a";
    });

    await expect(
      unlockConductorRecord("rec-1", "ally-1", { authorize }),
    ).rejects.toBeInstanceOf(ConductorUnlockForbiddenError);
    expect(authorize).toHaveBeenCalledWith(locked);
    expect(callOrder).toEqual(["lock", "authorize"]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("refuses unlock when CAS finds the row no longer locked", async () => {
    const locked = {
      id: "rec-1",
      allianceId: "ally-1",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      lockedAt: new Date("2026-06-10T12:00:00.000Z"),
    };
    mocks.for.mockResolvedValueOnce([locked]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    await expect(unlockConductorRecord("rec-1", "ally-1")).rejects.toThrow(
      "Conductor is not locked.",
    );
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
