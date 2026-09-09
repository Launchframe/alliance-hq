import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mocks.select,
    update: mocks.update,
    insert: mocks.insert,
  }),
  schema: {
    trainConductorRecords: {
      id: "id",
      allianceId: "allianceId",
      lockedAt: "lockedAt",
    },
    trains: { id: "id", conductorRecordId: "conductorRecordId" },
    trainCars: {},
    trainCarCargoItems: {},
  },
}));

vi.mock("@/lib/trains/pool", () => ({
  releasePoolSelectionForDate: mocks.releasePoolSelectionForDate,
}));

vi.mock("nanoid", () => ({ nanoid: () => "generated-id" }));

import {
  clearConductorAssignment,
  lockConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";

const unlockedDraft = {
  id: "rec-1",
  allianceId: "ally-1",
  date: "2026-06-10",
  seasonKey: null,
  conductorMemberId: "m1",
  conductorMemberName: "Alice",
  conductorRankEventId: null,
  vipMemberId: null,
  vipMemberName: null,
  vipRankEventId: null,
  conductorMechanism: null,
  vipMechanism: null,
  dayConfigId: null,
  guardianIsVip: 0,
  substituteForMemberId: null,
  substituteForMemberName: null,
  lockedAt: null,
  lockedByHqUserId: null,
};

describe("conductor lock CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.releasePoolSelectionForDate.mockResolvedValue(undefined);
  });

  it("upsertConductorDraft refuses update when a concurrent lock wins", async () => {
    mocks.limit.mockResolvedValueOnce([unlockedDraft]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    await expect(
      upsertConductorDraft({
        allianceId: "ally-1",
        date: "2026-06-10",
        conductorMemberId: "m2",
        conductorMemberName: "Bob",
      }),
    ).rejects.toThrow("Conductor is already locked for this day.");

    expect(mocks.updateReturning).toHaveBeenCalledOnce();
  });

  it("clearConductorAssignment refuses clear and skips pool release when lock wins", async () => {
    mocks.limit.mockResolvedValueOnce([unlockedDraft]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    await expect(
      clearConductorAssignment("ally-1", "2026-06-10"),
    ).rejects.toThrow("Conductor is already locked for this day.");

    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalled();
  });

  it("lockConductorRecord refuses double-lock and does not spawn a second train", async () => {
    mocks.limit.mockResolvedValueOnce([unlockedDraft]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    await expect(
      lockConductorRecord("rec-1", "ally-1", "hq-1"),
    ).rejects.toThrow("Conductor is already locked.");

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("lockConductorRecord claims lock then spawns train", async () => {
    const locked = {
      ...unlockedDraft,
      lockedAt: new Date("2026-06-10T12:00:00.000Z"),
      lockedByHqUserId: "hq-1",
    };
    mocks.limit
      .mockResolvedValueOnce([unlockedDraft])
      .mockResolvedValueOnce([{ id: "generated-id", conductorRecordId: "rec-1" }]);
    mocks.updateReturning.mockResolvedValueOnce([locked]);

    const row = await lockConductorRecord("rec-1", "ally-1", "hq-1");
    expect(row.lockedAt).toEqual(locked.lockedAt);
    expect(mocks.insert).toHaveBeenCalled();
    expect(mocks.insertValues).toHaveBeenCalled();
  });
});
