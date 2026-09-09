import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  delete: vi.fn(),
  deleteWhere: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mocks.select,
    delete: mocks.delete,
    update: mocks.update,
  }),
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

import { unlockConductorRecord } from "@/lib/trains/repository";

describe("unlockConductorRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.delete.mockReturnValue({ where: mocks.deleteWhere });
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.releasePoolSelectionForDate.mockResolvedValue(undefined);
  });

  it("clears lock without releasing depleting-pool while assignment remains", async () => {
    const locked = {
      id: "rec-1",
      allianceId: "ally-1",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      lockedAt: new Date("2026-06-10T12:00:00.000Z"),
    };
    const unlocked = { ...locked, lockedAt: null };
    mocks.limit.mockResolvedValueOnce([locked]);
    mocks.updateReturning.mockResolvedValueOnce([unlocked]);

    const row = await unlockConductorRecord("rec-1", "ally-1");

    expect(row.lockedAt).toBeNull();
    expect(row.conductorMemberId).toBe("m1");
    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalled();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedAt: null,
        lockedByHqUserId: null,
        discordDepartingSoonAt: null,
      }),
    );
    expect(mocks.updateReturning).toHaveBeenCalledOnce();
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
    mocks.limit.mockResolvedValueOnce([locked]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    await expect(unlockConductorRecord("rec-1", "ally-1")).rejects.toThrow(
      "Conductor is not locked.",
    );
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
