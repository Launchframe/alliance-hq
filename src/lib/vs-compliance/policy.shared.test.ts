import { describe, expect, it } from "vitest";
import { defaultVsPolicy, firstFullVsWeek, mergeVsPolicyPatch, policyForVsWeek, vsWeeklyThreshold } from "./policy.shared";

const now = new Date("2026-09-08T12:00:00.000Z");

describe("effective-dated VS policy", () => {
  it("defaults to disabled with a separate daily benchmark and no invented weekly minimum", () => {
    expect(defaultVsPolicy()).toEqual({ enabled: false, dailyTarget: 7_200_000, weeklyMinimum: null, leewayPct: 0, preset: "rank_aware", removalThreshold: 3 });
  });

  it.each([
    ["2026-09-07T01:59:59.999Z", "2026-09-13"],
    ["2026-09-07T02:00:00.000Z", "2026-09-20"],
    ["2026-09-08T12:00:00.000Z", "2026-09-20"],
    ["2026-12-31T12:00:00.000Z", "2027-01-10"],
  ])("only starts with a full future Mon–Sat week at %s", (instant, ending) => {
    expect(firstFullVsWeek(new Date(instant))).toBe(ending);
  });

  it("merges partial PATCH with the stored policy instead of resetting omitted fields", () => {
    const first = mergeVsPolicyPatch(null, { enabled: true, weeklyMinimum: 42_000_000, leewayPct: 10, preset: "consecutive", removalThreshold: 5 }, now);
    const next = mergeVsPolicyPatch(first, { dailyTarget: 8_000_000 }, now);
    expect(next).toEqual({ ...first, dailyTarget: 8_000_000, version: 2 });
  });

  it("requires explicit enabling and a weekly minimum", () => {
    expect(mergeVsPolicyPatch(null, { weeklyMinimum: 42_000_000 }, now).enabled).toBe(false);
    expect(() => mergeVsPolicyPatch(null, { enabled: true }, now)).toThrow("invalid_policy");
  });

  it.each([
    { preset: "fixed" }, { preset: null }, { enabled: "true" }, { leewayPct: -1 },
    { leewayPct: 101 }, { leewayPct: 0.5 }, { weeklyMinimum: 0 },
    { weeklyMinimum: Number.MAX_SAFE_INTEGER + 1 }, { dailyTarget: -1 },
    { removalThreshold: 2 }, { removalThreshold: 3.5 }, { enabled: undefined },
    { unexpected: true }, { effectiveWeek: "2026-09-14" }, { effectiveWeek: "2026-02-30" },
    { effectiveWeek: "2026-09-13" },
  ])("rejects malformed, unsupported, or retroactive policy patch %j", (patch) => {
    expect(() => mergeVsPolicyPatch(null, patch, now)).toThrow("invalid_policy");
  });

  it("preserves an already scheduled future effective week and never inserts behind it", () => {
    const future = mergeVsPolicyPatch(null, { effectiveWeek: "2026-10-04" }, now);
    expect(mergeVsPolicyPatch(future, { leewayPct: 5 }, now).effectiveWeek).toBe("2026-10-04");
    expect(() => mergeVsPolicyPatch(future, { effectiveWeek: "2026-09-27" }, now)).toThrow("invalid_policy");
  });

  it("resolves historical thresholds and same-week superseding versions without retroactive escalation", () => {
    const first = mergeVsPolicyPatch(null, { enabled: true, weeklyMinimum: 20_000_000 }, now);
    const second = mergeVsPolicyPatch(first, { weeklyMinimum: 50_000_000, effectiveWeek: "2026-10-04" }, now);
    const third = mergeVsPolicyPatch(second, { leewayPct: 10 }, now);
    expect(policyForVsWeek([third, first, second], "2026-09-13")).toBeNull();
    expect(policyForVsWeek([third, first, second], "2026-09-27")).toEqual(first);
    expect(policyForVsWeek([third, first, second], "2026-10-04")).toEqual(third);
  });

  it("uses exact integer arithmetic, including safe scores above 32-bit range", () => {
    expect(vsWeeklyThreshold(42_000_001, 10)).toBe(37_800_001);
    expect(vsWeeklyThreshold(Number.MAX_SAFE_INTEGER, 1)).toBe(8_917_127_262_193_582);
    expect(vsWeeklyThreshold(42_000_000, 100)).toBe(0);
  });
});
