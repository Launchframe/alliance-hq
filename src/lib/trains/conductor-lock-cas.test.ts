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

import { clearConductorAssignment } from "@/lib/trains/repository";

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

  // upsertConductorDraft's "concurrent lock wins" CAS rejection is covered against
  // its current transaction-wrapped, coverage-guarded implementation in
  // repository-coverage.server.test.ts ("transaction-bound draft assignment").

  it("clearConductorAssignment refuses clear and skips pool release when lock wins", async () => {
    mocks.limit.mockResolvedValueOnce([unlockedDraft]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    await expect(
      clearConductorAssignment("ally-1", "2026-06-10"),
    ).rejects.toThrow("Conductor is already locked for this day.");

    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalled();
  });

  // lockConductorRecord's CAS + spawn behavior is covered against its current
  // transaction-wrapped, coverage-guarded implementation in
  // repository-coverage.server.test.ts ("transaction-bound lock assignment").
});
