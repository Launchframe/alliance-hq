import { describe, expect, it } from "vitest";

import { formatDepositSlipGameTimestamp } from "@/lib/banks/deposit-slip-ocr/deposit-slip-game-timestamp.shared";

describe("formatDepositSlipGameTimestamp", () => {
  it("formats UTC wall clock with unpadded month/day and 24h time", () => {
    expect(
      formatDepositSlipGameTimestamp("2026-07-09T12:31:48.000Z"),
    ).toBe("2026-7-9 12:31:48");
  });

  it("returns em dash for missing or invalid input", () => {
    expect(formatDepositSlipGameTimestamp(null)).toBe("—");
    expect(formatDepositSlipGameTimestamp("not-a-date")).toBe("—");
  });
});
