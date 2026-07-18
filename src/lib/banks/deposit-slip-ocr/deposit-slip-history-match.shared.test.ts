import { describe, expect, it } from "vitest";

import { DEPOSIT_AT_PROXIMITY_MS } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import {
  findHighConfidenceHistoricalDepositMatch,
  isHighConfidenceHistoricalDepositMatch,
  pickLatestDepositSlip,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-history-match.shared";
import type { SerializedDepositSlip } from "@/lib/banks/types.shared";

function identity(
  overrides: Partial<{
    commanderName: string;
    depositAt: string;
    amount: number;
    termDays: number;
    depositAllianceTag: string | null;
  }> = {},
) {
  return {
    commanderName: "Blue Investor",
    depositAt: "2026-07-10T12:14:34.000Z",
    amount: 6000,
    termDays: 3,
    depositAllianceTag: "Roar",
    ...overrides,
  };
}

function slip(
  overrides: Partial<SerializedDepositSlip> & { id: string },
): SerializedDepositSlip {
  return {
    bankId: "bank-1",
    depositAt: "2026-07-10T12:14:34.000Z",
    termDays: 3,
    maturesAt: "2026-07-13T12:14:34.000Z",
    status: "locked",
    outcomeAt: null,
    amount: 6000,
    outcomeAmount: null,
    depositAllianceTag: "Roar",
    depositAllianceId: null,
    commanderName: "Blue Investor",
    commanderId: null,
    allianceMemberId: null,
    createdAt: "2026-07-10T12:15:00.000Z",
    updatedAt: "2026-07-10T12:15:00.000Z",
    ...overrides,
  };
}

describe("isHighConfidenceHistoricalDepositMatch", () => {
  it("matches the same commander/amount/term within the proximity window", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAt: "2026-07-10T12:20:00.000Z" }),
        identity({ depositAt: "2026-07-10T12:14:34.000Z" }),
      ),
    ).toBe(true);
  });

  it("rejects when depositAt is outside the proximity window", () => {
    const outside = new Date(
      Date.parse("2026-07-10T12:14:34.000Z") + DEPOSIT_AT_PROXIMITY_MS + 1,
    ).toISOString();
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAt: outside }),
        identity(),
      ),
    ).toBe(false);
  });

  it("rejects different amounts or terms", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(identity({ amount: 7000 }), identity()),
    ).toBe(false);
    expect(
      isHighConfidenceHistoricalDepositMatch(identity({ termDays: 1 }), identity()),
    ).toBe(false);
  });

  it("rejects conflicting alliance tags when both are set", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAllianceTag: "GRoW" }),
        identity({ depositAllianceTag: "Roar" }),
      ),
    ).toBe(false);
  });

  it("allows a missing tag on either side", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAllianceTag: null }),
        identity({ depositAllianceTag: "Roar" }),
      ),
    ).toBe(true);
  });
});

describe("findHighConfidenceHistoricalDepositMatch", () => {
  it("returns the matching history row", () => {
    const history = [
      identity({ commanderName: "Other", depositAt: "2026-07-09T12:00:00.000Z" }),
      identity({ depositAt: "2026-07-10T12:16:00.000Z" }),
    ];
    expect(findHighConfidenceHistoricalDepositMatch(identity(), history)).toBe(
      history[1],
    );
  });
});

describe("pickLatestDepositSlip", () => {
  it("returns null for an empty list", () => {
    expect(pickLatestDepositSlip([])).toBeNull();
  });

  it("picks the newest depositAt, breaking ties with createdAt", () => {
    const older = slip({
      id: "a",
      depositAt: "2026-07-10T12:00:00.000Z",
      createdAt: "2026-07-10T12:01:00.000Z",
    });
    const newerSameMinuteEarlierCreate = slip({
      id: "b",
      depositAt: "2026-07-11T12:00:00.000Z",
      createdAt: "2026-07-11T12:01:00.000Z",
    });
    const newerSameMinuteLaterCreate = slip({
      id: "c",
      depositAt: "2026-07-11T12:00:00.000Z",
      createdAt: "2026-07-11T12:05:00.000Z",
    });
    expect(
      pickLatestDepositSlip([
        older,
        newerSameMinuteEarlierCreate,
        newerSameMinuteLaterCreate,
      ])?.id,
    ).toBe("c");
  });
});
