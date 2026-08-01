import { describe, expect, it } from "vitest";

import {
  bankManagementActiveDepositCount,
  compareBanksForManagementDisplay,
  sortBanksForManagementDisplay,
  type BankForManagementSort,
} from "@/lib/banks/bank-list-sort.shared";
import type { SerializedDepositSlip } from "@/lib/banks/types.shared";

const now = new Date("2026-07-15T12:00:00.000Z");

function slip(
  overrides: Partial<SerializedDepositSlip> & { id: string },
): SerializedDepositSlip {
  return {
    bankId: "bank",
    depositAt: "2026-07-01T00:00:00.000Z",
    termDays: 3,
    maturesAt: "2026-07-20T00:00:00.000Z",
    status: "locked",
    outcomeAt: null,
    amount: 1000,
    outcomeAmount: null,
    depositAllianceTag: null,
    depositAllianceId: null,
    commanderName: "cmd",
    commanderId: null,
    allianceMemberId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function bank(
  overrides: Partial<BankForManagementSort> & {
    coordX: number;
    coordY: number;
    level: number;
  },
): BankForManagementSort {
  return {
    currentDepositCount: null,
    depositSlips: [],
    ...overrides,
  };
}

describe("bankManagementActiveDepositCount", () => {
  it("uses active slip count when slips exist", () => {
    const row = bank({
      coordX: 1,
      coordY: 1,
      level: 5,
      depositSlips: [
        slip({ id: "a", status: "locked", maturesAt: "2026-08-01T00:00:00.000Z" }),
        slip({ id: "b", status: "looted", maturesAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    expect(bankManagementActiveDepositCount(row, now)).toBe(1);
  });

  it("falls back to currentDepositCount when there are no slips", () => {
    expect(
      bankManagementActiveDepositCount(
        bank({ coordX: 1, coordY: 1, level: 5, currentDepositCount: 42 }),
        now,
      ),
    ).toBe(42);
  });

  it("treats null currentDepositCount as zero without slips", () => {
    expect(
      bankManagementActiveDepositCount(
        bank({ coordX: 1, coordY: 1, level: 5, currentDepositCount: null }),
        now,
      ),
    ).toBe(0);
  });
});

describe("compareBanksForManagementDisplay", () => {
  it("sorts level descending", () => {
    const low = bank({ coordX: 1, coordY: 1, level: 3 });
    const high = bank({ coordX: 2, coordY: 1, level: 6 });
    expect(compareBanksForManagementDisplay(low, high, now)).toBeGreaterThan(0);
    expect(compareBanksForManagementDisplay(high, low, now)).toBeLessThan(0);
  });

  it("sorts active deposit count descending within the same level", () => {
    const fewer = bank({
      coordX: 1,
      coordY: 1,
      level: 5,
      currentDepositCount: 10,
    });
    const more = bank({
      coordX: 2,
      coordY: 1,
      level: 5,
      currentDepositCount: 90,
    });
    expect(compareBanksForManagementDisplay(fewer, more, now)).toBeGreaterThan(0);
  });

  it("uses slip-derived count for banks with slips, not currentDepositCount", () => {
    const slipHeavy = bank({
      coordX: 1,
      coordY: 1,
      level: 5,
      currentDepositCount: 5,
      depositSlips: [
        slip({ id: "a", status: "locked", maturesAt: "2026-08-01T00:00:00.000Z" }),
        slip({ id: "b", status: "locked", maturesAt: "2026-08-02T00:00:00.000Z" }),
        slip({ id: "c", status: "locked", maturesAt: "2026-08-03T00:00:00.000Z" }),
        slip({ id: "d", status: "locked", maturesAt: "2026-08-04T00:00:00.000Z" }),
        slip({ id: "e", status: "locked", maturesAt: "2026-08-05T00:00:00.000Z" }),
      ],
    });
    const snapshotOnly = bank({
      coordX: 2,
      coordY: 1,
      level: 5,
      currentDepositCount: 4,
    });
    expect(
      compareBanksForManagementDisplay(snapshotOnly, slipHeavy, now),
    ).toBeGreaterThan(0);
  });

  it("tiebreaks by coordX then coordY ascending", () => {
    const first = bank({ coordX: 100, coordY: 50, level: 5, currentDepositCount: 10 });
    const second = bank({ coordX: 100, coordY: 60, level: 5, currentDepositCount: 10 });
    const third = bank({ coordX: 200, coordY: 1, level: 5, currentDepositCount: 10 });
    expect(compareBanksForManagementDisplay(first, second, now)).toBeLessThan(0);
    expect(compareBanksForManagementDisplay(second, third, now)).toBeLessThan(0);
  });
});

describe("sortBanksForManagementDisplay", () => {
  it("orders banks for management display", () => {
    const rows = [
      bank({ coordX: 300, coordY: 1, level: 4, currentDepositCount: 80 }),
      bank({ coordX: 100, coordY: 20, level: 6, currentDepositCount: 10 }),
      bank({ coordX: 100, coordY: 10, level: 6, currentDepositCount: 50 }),
      bank({ coordX: 200, coordY: 1, level: 6, currentDepositCount: 50 }),
    ];
    const sorted = sortBanksForManagementDisplay(rows, now);
    expect(sorted.map((row) => row.coordX)).toEqual([100, 200, 100, 300]);
    expect(sorted[0]?.coordY).toBe(10);
    expect(sorted[1]?.coordY).toBe(1);
    expect(sorted[2]?.coordY).toBe(20);
    expect(sorted[3]?.level).toBe(4);
  });
});
