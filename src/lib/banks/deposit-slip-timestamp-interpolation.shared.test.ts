import { describe, expect, it } from "vitest";

import {
  interpolateMissingDepositSlipTimestamps,
  isValidDepositSlipReviewTimestamp,
} from "@/lib/banks/deposit-slip-timestamp-interpolation.shared";

describe("isValidDepositSlipReviewTimestamp", () => {
  it("accepts parseable ISO timestamps", () => {
    expect(isValidDepositSlipReviewTimestamp("2026-07-10T12:00:00.000Z")).toBe(
      true,
    );
  });

  it("rejects empty and invalid values", () => {
    expect(isValidDepositSlipReviewTimestamp(null)).toBe(false);
    expect(isValidDepositSlipReviewTimestamp("")).toBe(false);
    expect(isValidDepositSlipReviewTimestamp("not-a-date")).toBe(false);
  });
});

describe("interpolateMissingDepositSlipTimestamps", () => {
  it("returns rows unchanged when disabled", () => {
    const rows = [
      {
        id: "a",
        powerLevel: null,
        frameIndex: 1,
      },
    ];
    expect(
      interpolateMissingDepositSlipTimestamps(rows, { enabled: false }),
    ).toEqual([{ ...rows[0], depositAtInterpolated: false }]);
  });

  it("linearly interpolates between nearest valid frame anchors", () => {
    const rows = [
      {
        id: "a",
        powerLevel: "2026-07-10T10:00:00.000Z",
        frameIndex: 10,
      },
      {
        id: "b",
        powerLevel: null,
        frameIndex: 20,
      },
      {
        id: "c",
        powerLevel: null,
        frameIndex: 30,
      },
      {
        id: "d",
        powerLevel: "2026-07-10T12:00:00.000Z",
        frameIndex: 40,
      },
    ];
    const [b, c] = interpolateMissingDepositSlipTimestamps(rows, {
      enabled: true,
    }).filter((row) => row.id === "b" || row.id === "c");

    expect(b?.depositAtInterpolated).toBe(true);
    expect(c?.depositAtInterpolated).toBe(true);
    expect(Date.parse(b!.powerLevel!)).toBe(Date.parse("2026-07-10T10:40:00.000Z"));
    expect(Date.parse(c!.powerLevel!)).toBe(Date.parse("2026-07-10T11:20:00.000Z"));
  });

  it("does not extrapolate when only one side has a valid timestamp", () => {
    const rows = [
      { id: "a", powerLevel: null, frameIndex: 1 },
      {
        id: "b",
        powerLevel: "2026-07-10T10:00:00.000Z",
        frameIndex: 2,
      },
    ];
    const [a] = interpolateMissingDepositSlipTimestamps(rows, { enabled: true });
    expect(a?.powerLevel).toBeNull();
    expect(a?.depositAtInterpolated).toBe(false);
  });
});
