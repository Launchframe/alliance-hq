import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  forUpdate: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction: mocks.transaction,
  }),
  schema: {
    trainConductorRecords: {
      id: "id",
      allianceId: "allianceId",
      date: "date",
      seasonKey: "seasonKey",
      conductorMemberId: "conductorMemberId",
      conductorMemberName: "conductorMemberName",
      conductorRankEventId: "conductorRankEventId",
      vipMemberId: "vipMemberId",
      vipMemberName: "vipMemberName",
      vipRankEventId: "vipRankEventId",
      substituteForMemberId: "substituteForMemberId",
      substituteForMemberName: "substituteForMemberName",
      lockedAt: "lockedAt",
      updatedAt: "updatedAt",
    },
    conductorPoolEntries: {
      allianceId: "allianceId",
      memberId: "memberId",
      selectedForDate: "selectedForDate",
      selectedAt: "selectedAt",
    },
  },
}));

vi.mock("nanoid", () => ({ nanoid: () => "generated-id" }));

import { swapConductorAssignmentsAtomic } from "@/lib/trains/repository";

type TxRow = {
  id: string;
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  vipMemberId: string | null;
  lockedAt: Date | null;
};

describe("swapConductorAssignmentsAtomic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({
      limit: mocks.limit,
      orderBy: mocks.orderBy,
    });
    mocks.orderBy.mockReturnValue({ for: mocks.forUpdate });
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("uses a transaction and aborts when source CAS fails", async () => {
    mocks.transaction.mockImplementation(async (fn) => {
      const tx = {
        select: mocks.select,
        insert: mocks.insert,
        update: mocks.update,
      };
      mocks.limit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mocks.forUpdate.mockResolvedValueOnce([
        {
          id: "rec-a",
          date: "2026-06-10",
          conductorMemberId: "someone-else",
          conductorMemberName: "Eve",
          vipMemberId: null,
          lockedAt: null,
        },
        {
          id: "rec-b",
          date: "2026-06-12",
          conductorMemberId: "m2",
          conductorMemberName: "Bob",
          vipMemberId: null,
          lockedAt: null,
        },
      ]);
      return fn(tx);
    });

    await expect(
      swapConductorAssignmentsAtomic({
        allianceId: "ally-1",
        dateA: "2026-06-10",
        dateB: "2026-06-12",
        seasonKey: "S1",
        expectedMemberA: { id: "m1", name: "Alice" },
        expectedMemberB: { id: "m2", name: "Bob" },
        rankEventIdForA: null,
        rankEventIdForB: null,
      }),
    ).rejects.toThrow(/source day changed during swap/i);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("open-move clears source VIP inside the same transaction", async () => {
    const rowA: TxRow = {
      id: "rec-a",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      vipMemberId: "m9",
      lockedAt: null,
    };
    const rowB: TxRow = {
      id: "rec-b",
      date: "2026-06-12",
      conductorMemberId: null,
      conductorMemberName: null,
      vipMemberId: null,
      lockedAt: null,
    };

    mocks.transaction.mockImplementation(async (fn) => {
      const tx = {
        select: mocks.select,
        insert: mocks.insert,
        update: mocks.update,
      };
      mocks.limit
        .mockResolvedValueOnce([{ id: "rec-a" }])
        .mockResolvedValueOnce([{ id: "rec-b" }])
        .mockResolvedValueOnce([
          {
            ...rowA,
            conductorMemberId: null,
            conductorMemberName: null,
            vipMemberId: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...rowB,
            conductorMemberId: "m1",
            conductorMemberName: "Alice",
          },
        ]);
      mocks.forUpdate.mockResolvedValueOnce([rowA, rowB]);
      return fn(tx);
    });

    const result = await swapConductorAssignmentsAtomic({
      allianceId: "ally-1",
      dateA: "2026-06-10",
      dateB: "2026-06-12",
      seasonKey: "S1",
      expectedMemberA: { id: "m1", name: "Alice" },
      expectedMemberB: null,
      rankEventIdForA: null,
      rankEventIdForB: "rank-1",
    });

    expect(result.recordB.conductorMemberId).toBe("m1");
    expect(result.recordA.conductorMemberId).toBeNull();
    expect(result.recordA.vipMemberId).toBeNull();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalled();
  });
});
