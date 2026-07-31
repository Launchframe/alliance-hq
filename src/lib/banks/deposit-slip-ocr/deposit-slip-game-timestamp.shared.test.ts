import { describe, expect, it } from "vitest";

import {
  decodeDepositAtPowerLevel,
  encodeDepositAtForParsedRow,
  formatDepositSlipGameTimestamp,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-game-timestamp.shared";

describe("formatDepositSlipGameTimestamp", () => {
  it("formats UTC wall clock with unpadded month/day and 24h time", () => {
    expect(
      formatDepositSlipGameTimestamp("2026-07-09T12:31:48.000Z"),
    ).toBe("2026-7-9 12:31:48");
  });

  it("shows salvaged time-of-day when only pending time survived OCR", () => {
    expect(formatDepositSlipGameTimestamp("pending:12:14:34")).toBe(
      "12:14:34",
    );
  });

  it("returns em dash for missing or invalid input", () => {
    expect(formatDepositSlipGameTimestamp(null)).toBe("—");
    expect(formatDepositSlipGameTimestamp("not-a-date")).toBe("—");
  });
});

describe("encodeDepositAtForParsedRow / decodeDepositAtPowerLevel", () => {
  it("round-trips pending time without a full depositAt", () => {
    const encoded = encodeDepositAtForParsedRow({
      depositAt: null,
      depositAtTimePendingDate: {
        hour: 9,
        minute: 5,
        second: 1,
        round: "none",
      },
    });
    expect(encoded).toBe("pending:09:05:01");
    expect(decodeDepositAtPowerLevel(encoded)).toEqual({
      depositAt: null,
      depositAtTimePendingDate: {
        hour: 9,
        minute: 5,
        second: 1,
        round: "none",
      },
    });
  });

  it("prefers depositAt over pending time", () => {
    expect(
      encodeDepositAtForParsedRow({
        depositAt: "2026-07-10T12:00:00.000Z",
        depositAtTimePendingDate: {
          hour: 9,
          minute: 0,
          second: 0,
          round: "none",
        },
      }),
    ).toBe("2026-07-10T12:00:00.000Z");
  });
});
