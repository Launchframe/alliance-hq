import { describe, expect, it } from "vitest";

import {
  isoToRelativeDurationDigits,
  isValidRelativeDurationDigits,
  parseRelativeDurationDigits,
  relativeDurationDigitsToIso,
} from "@/lib/battle-plan/relative-duration.shared";

describe("relative duration helpers", () => {
  it("pads partial digit entry from the left for parsing", () => {
    expect(parseRelativeDurationDigits("130")).toEqual({
      days: 0,
      hours: 1,
      minutes: 30,
    });
    expect(parseRelativeDurationDigits("010230")).toEqual({
      days: 1,
      hours: 2,
      minutes: 30,
    });
  });

  it("rejects empty, zero, and out-of-range DD:HH:MM values", () => {
    expect(isValidRelativeDurationDigits("")).toBe(false);
    expect(isValidRelativeDurationDigits("000000")).toBe(false);
    expect(isValidRelativeDurationDigits("000001")).toBe(true);
    expect(isValidRelativeDurationDigits("002330")).toBe(true);
    expect(isValidRelativeDurationDigits("002400")).toBe(false);
    expect(isValidRelativeDurationDigits("002599")).toBe(false);
  });

  it("converts relative duration digits to an absolute ISO instant", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    expect(relativeDurationDigitsToIso("000130", now)).toBe(
      "2026-07-10T13:30:00.000Z",
    );
    expect(relativeDurationDigitsToIso("010000", now)).toBe(
      "2026-07-11T12:00:00.000Z",
    );
  });

  it("converts a future ISO instant back to DDHHMM digits", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    expect(isoToRelativeDurationDigits("2026-07-10T13:30:00.000Z", now)).toBe(
      "000130",
    );
  });
});
