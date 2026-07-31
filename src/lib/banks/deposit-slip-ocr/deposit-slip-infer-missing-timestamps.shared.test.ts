import { describe, expect, it } from "vitest";

import {
  inferMissingDepositSlipTimestamps,
  repairInvalidDepositSlipDates,
  resolveDepositSlipSeasonYear,
  roundDepositSlipUtcToHour,
  roundDepositSlipUtcToNearestTenMinutes,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-infer-missing-timestamps.shared";
import type { ParsedDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";

function slip(
  partial: Partial<ParsedDepositSlipDraft> & {
    commanderName: string;
    sourceFrameIndex?: number;
  },
): ParsedDepositSlipDraft {
  return {
    depositAt: partial.depositAt ?? null,
    depositAtTimePendingDate: partial.depositAtTimePendingDate,
    termDays: partial.termDays ?? 1,
    amount: partial.amount ?? 6000,
    status: partial.status ?? "locked",
    outcomeAmount: partial.outcomeAmount ?? null,
    outcomeKind: partial.outcomeKind ?? null,
    outcomeAt: partial.outcomeAt ?? null,
    identity: {
      gameServerNumber: 1203,
      allianceTag: "LFgo",
      commanderName: partial.commanderName,
      rawIdentity: `#1203[LFgo]${partial.commanderName}`,
    },
    sourceFrameIndex: partial.sourceFrameIndex,
    confidence: partial.confidence ?? null,
  };
}

describe("resolveDepositSlipSeasonYear", () => {
  it("uses current UTC year on or after March 1", () => {
    expect(
      resolveDepositSlipSeasonYear([], new Date("2026-07-15T00:00:00.000Z")),
    ).toBe(2026);
  });

  it("uses shared parsed year before March 1 when all rows agree", () => {
    expect(
      resolveDepositSlipSeasonYear(
        [{ depositAt: "2025-12-01T10:00:00.000Z" }],
        new Date("2026-02-15T00:00:00.000Z"),
      ),
    ).toBe(2025);
  });

  it("returns null before March 1 when parsed years disagree", () => {
    expect(
      resolveDepositSlipSeasonYear(
        [
          { depositAt: "2025-12-01T10:00:00.000Z" },
          { depositAt: "2026-01-02T10:00:00.000Z" },
        ],
        new Date("2026-02-15T00:00:00.000Z"),
      ),
    ).toBeNull();
  });
});

describe("roundDepositSlipUtcToNearestTenMinutes", () => {
  it("rounds to the nearest 10-minute mark", () => {
    expect(
      roundDepositSlipUtcToNearestTenMinutes("2026-07-10T12:14:34.000Z"),
    ).toBe("2026-07-10T12:10:00.000Z");
    expect(
      roundDepositSlipUtcToNearestTenMinutes("2026-07-10T12:16:34.000Z"),
    ).toBe("2026-07-10T12:20:00.000Z");
  });
});

describe("roundDepositSlipUtcToHour", () => {
  it("truncates minutes and seconds to the top of the UTC hour", () => {
    expect(roundDepositSlipUtcToHour("2026-07-10T12:14:34.000Z")).toBe(
      "2026-07-10T12:00:00.000Z",
    );
  });
});

describe("repairInvalidDepositSlipDates", () => {
  it("borrows YYYY-MM-DD from the nearest frame while keeping OCR time-of-day", () => {
    const slips = [
      slip({
        commanderName: "Neighbor",
        depositAt: "2026-07-25T16:00:00.000Z",
        sourceFrameIndex: 140,
      }),
      slip({
        commanderName: "GarbledDate",
        depositAt: null,
        sourceFrameIndex: 143,
        depositAtTimePendingDate: {
          hour: 17,
          minute: 12,
          second: 48,
          round: "none",
        },
      }),
    ];

    repairInvalidDepositSlipDates(slips);

    expect(slips[1]?.depositAt).toBe("2026-07-25T17:12:48.000Z");
    expect(slips[1]?.depositAtTimePendingDate).toBeUndefined();
  });

  it("picks the closer neighbor when anchors exist on both sides", () => {
    const slips = [
      slip({
        commanderName: "Before",
        depositAt: "2026-07-24T10:00:00.000Z",
        sourceFrameIndex: 100,
      }),
      slip({
        commanderName: "Target",
        depositAt: null,
        sourceFrameIndex: 103,
        depositAtTimePendingDate: {
          hour: 9,
          minute: 30,
          second: 0,
          round: "ten_minutes",
        },
      }),
      slip({
        commanderName: "After",
        depositAt: "2026-07-26T10:00:00.000Z",
        sourceFrameIndex: 110,
      }),
    ];

    repairInvalidDepositSlipDates(slips);

    expect(slips[1]?.depositAt).toBe("2026-07-24T09:30:00.000Z");
  });

  it("leaves the slip unchanged when no neighbor date is available", () => {
    const slips = [
      slip({
        commanderName: "Solo",
        depositAt: null,
        sourceFrameIndex: 5,
        depositAtTimePendingDate: {
          hour: 12,
          minute: 0,
          second: 0,
          round: "none",
        },
      }),
    ];

    repairInvalidDepositSlipDates(slips);

    expect(slips[0]?.depositAt).toBeNull();
    expect(slips[0]?.depositAtTimePendingDate).toEqual({
      hour: 12,
      minute: 0,
      second: 0,
      round: "none",
    });
  });
});

describe("inferMissingDepositSlipTimestamps", () => {
  it("interpolates timestamps between neighboring frames", () => {
    const slips = [
      slip({
        commanderName: "Alpha",
        depositAt: "2026-07-10T12:00:00.000Z",
        sourceFrameIndex: 10,
      }),
      slip({
        commanderName: "Bravo",
        depositAt: null,
        sourceFrameIndex: 20,
      }),
      slip({
        commanderName: "Charlie",
        depositAt: "2026-07-10T13:00:00.000Z",
        sourceFrameIndex: 30,
      }),
    ];

    inferMissingDepositSlipTimestamps(slips);

    expect(slips[1]?.depositAt).toBe("2026-07-10T12:30:00.000Z");
  });

  it("reuses a same-frame anchor when one exists", () => {
    const slips = [
      slip({
        commanderName: "Anchor",
        depositAt: "2026-07-10T12:07:00.000Z",
        sourceFrameIndex: 20,
      }),
      slip({
        commanderName: "Missing",
        depositAt: null,
        sourceFrameIndex: 20,
      }),
    ];

    inferMissingDepositSlipTimestamps(slips);

    expect(slips[1]?.depositAt).toBe("2026-07-10T12:10:00.000Z");
  });

  it("does not overwrite slips waiting on date repair", () => {
    const slips = [
      slip({
        commanderName: "Alpha",
        depositAt: "2026-07-10T12:00:00.000Z",
        sourceFrameIndex: 10,
      }),
      slip({
        commanderName: "Bravo",
        depositAt: null,
        sourceFrameIndex: 20,
        depositAtTimePendingDate: {
          hour: 17,
          minute: 12,
          second: 48,
          round: "none",
        },
      }),
      slip({
        commanderName: "Charlie",
        depositAt: "2026-07-10T13:00:00.000Z",
        sourceFrameIndex: 30,
      }),
    ];

    inferMissingDepositSlipTimestamps(slips);

    expect(slips[1]?.depositAt).toBeNull();
    expect(slips[1]?.depositAtTimePendingDate).toEqual({
      hour: 17,
      minute: 12,
      second: 48,
      round: "none",
    });
  });
});
