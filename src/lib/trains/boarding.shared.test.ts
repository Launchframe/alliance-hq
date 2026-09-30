import { describe, expect, it } from "vitest";
import { boardingWindow, parseBoardingCountdown } from "./boarding.shared";

const lock = "2026-09-10T12:00:00.000Z";
const observed = "2026-09-10T12:10:00.000Z";

describe("train boarding countdown", () => {
  it.each([["04:00:00", 14400], ["01:20:00", 4800], ["00:05:00", 300], ["00:00:00", 0]])("parses %s", (value, seconds) => {
    expect(parseBoardingCountdown(value)).toBe(seconds);
  });
  it.each(["04:00:01", "-01:00:00", "00:60:00", "00:00:60", "4 hours", "", null])("rejects %s", (value) => {
    expect(() => parseBoardingCountdown(value)).toThrow();
  });
  it("calculates the original opening and actual closing, not four more hours", () => {
    expect(boardingWindow({ lockedAt: lock, observedAt: observed, remainingSeconds: 4800 })).toEqual({ startsAt: "2026-09-10T09:30:00.000Z", endsAt: "2026-09-10T13:25:00.000Z", basis: "countdown" });
  });
  it("uses lock time, not a late skip time, for the estimate", () => {
    expect(boardingWindow({ lockedAt: lock, observedAt: observed, remainingSeconds: null })).toEqual({ startsAt: lock, endsAt: "2026-09-10T15:55:00.000Z", basis: "estimated" });
  });
  it("does not move an expired closing time forward", () => {
    const window = boardingWindow({ lockedAt: lock, observedAt: observed, remainingSeconds: 240 });
    expect(window.endsAt).toBe("2026-09-10T12:09:00.000Z");
  });
  it("preserves exactly 235 minutes across midnight", () => {
    const window = boardingWindow({ lockedAt: lock, observedAt: "2026-09-11T01:30:00.000Z", remainingSeconds: 14400 });
    expect(Date.parse(window.endsAt) - Date.parse(window.startsAt)).toBe(235 * 60_000);
  });
});
