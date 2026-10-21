import { describe, expect, it } from "vitest";
import { defaultDisplayPreferences, displayPreferencesSchema, matchesUnsortedFilters, normalizeCountry, metric, continuousTenureDays } from "./display-preferences.shared";

describe("support-team personal presentation", () => {
  it("validates independent toggles and rejects caller identity and unknown settings", () => {
    expect(displayPreferencesSchema.parse({ ...defaultDisplayPreferences, thp: false })).toEqual({ professionLevel: false, baseLevel: false, thp: false, kills: true, tenureDays: false });
    expect(displayPreferencesSchema.safeParse({ ...defaultDisplayPreferences, hqUserId: "other" }).success).toBe(false);
    expect(displayPreferencesSchema.safeParse({ ...defaultDisplayPreferences, thp: "true" }).success).toBe(false);
  });
  it("shows kills for preferences saved before the kills toggle existed", () => {
    expect(displayPreferencesSchema.parse({ professionLevel: true, baseLevel: false, thp: false, tenureDays: true })).toEqual({ professionLevel: true, baseLevel: false, thp: false, kills: true, tenureDays: true });
    expect(displayPreferencesSchema.parse({ ...defaultDisplayPreferences, kills: false }).kills).toBe(false);
  });
  it("keeps missing metrics unknown, distinct from zero", () => {
    expect(metric(null)).toBeNull();
    expect(metric(undefined)).toBeNull();
    expect(metric("bad")).toBeNull();
    expect(metric(0)).toBe(0);
    expect(metric(-1)).toBeNull();
  });
  it("only derives current continuous tenure from one current stint", () => {
    const now = Date.parse("2026-09-10T00:00:00Z");
    expect(continuousTenureDays(["2026-09-08T00:00:00Z"], now)).toBe(2);
    expect(continuousTenureDays([], now)).toBeNull();
    expect(continuousTenureDays(["2020-01-01", "2026-09-08"], now)).toBeNull();
    expect(continuousTenureDays(["2026-09-11"], now)).toBeNull();
  });
  it("validates country codes without inventing language", () => {
    expect(normalizeCountry("br")).toBe("BR");
    expect(normalizeCountry("??")).toBeNull();
    expect(normalizeCountry("ZZ")).toBeNull();
  });
  it("filters only supplied pool members and treats unknown handling explicitly", () => {
    const m = { country: null, professionLevel: null, baseLevel: 20, thp: null, kills: 500, tenureDays: 3 };
    expect(matchesUnsortedFilters(m, { kills: { min: 1000 } })).toBe(false);
    expect(matchesUnsortedFilters(m, { kills: { min: 100, max: 1000 } })).toBe(true);
    expect(matchesUnsortedFilters(m, {})).toBe(true);
    expect(matchesUnsortedFilters(m, { thp: { min: 1, unknown: "include" } })).toBe(true);
    expect(matchesUnsortedFilters(m, { thp: { min: 1, unknown: "exclude" } })).toBe(false);
    expect(matchesUnsortedFilters(m, { baseLevel: { unknown: "only" } })).toBe(false);
    expect(matchesUnsortedFilters(m, { countries: ["unknown"] })).toBe(true);
  });
});
