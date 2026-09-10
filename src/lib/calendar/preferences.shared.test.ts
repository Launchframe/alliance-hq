import { describe, expect, it } from "vitest";
import { parseCalendarPreferences } from "./preferences.shared";

describe("account-wide calendar alerts", () => {
  it("keeps multiple offsets, independent of Commander identity", () => {
    expect(parseCalendarPreferences({ alerts: [1, 10], locale: "en-US", timezone: "America/New_York" })).toEqual({ alerts: [10, 1], locale: "en-US", timezone: "America/New_York" });
  });
  it("supports an explicit off preference", () => {
    expect(parseCalendarPreferences({ alerts: [], locale: "pt-BR", timezone: "UTC" }).alerts).toEqual([]);
  });
  it.each([[1, 1], [0], [-1], [1.5], [40321], [1, 2, 3, 4, 5, 6]])("rejects invalid offsets %j", (...alerts) => {
    expect(() => parseCalendarPreferences({ alerts, locale: "en-US", timezone: "UTC" })).toThrow();
  });
  it("rejects invalid locale and timezone", () => {
    expect(() => parseCalendarPreferences({ alerts: [10], locale: "xx", timezone: "invalid" })).toThrow();
  });
});
