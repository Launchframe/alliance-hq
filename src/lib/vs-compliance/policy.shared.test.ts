import { describe, expect, it } from "vitest";
import { defaultVsDailyPolicy, defaultVsPolicy, firstFullVsWeek, mergeVsPolicyPatch, policyForVsWeek, vsThreshold, vsWeeklyThreshold } from "./policy.shared";

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
    expect(vsThreshold(42_000_001, 10)).toBe(37_800_001);
    expect(vsThreshold(7_200_000, 0)).toBe(7_200_000);
  });
});

describe("daily consistency policy (model 2)", () => {
  const legacy = mergeVsPolicyPatch(null, { enabled: true, weeklyMinimum: 40_000_000 }, now);

  it("defaults to disabled with one-week demotion and two-week promotion sequences", () => {
    expect(defaultVsDailyPolicy()).toEqual({ modelVersion: 2, enabled: false, dailyTarget: 7_200_000, leewayPct: 0, allowedMissedDays: 0, demotion: { unit: "weeks", length: 1 }, promotion: { unit: "weeks", length: 2 } });
  });

  it("creates a v2 policy from scratch and from a v1 predecessor, carrying shared fields only", () => {
    const fresh = mergeVsPolicyPatch(null, { modelVersion: 2, enabled: true, dailyTarget: 6_000_000, allowedMissedDays: 1, demotion: { unit: "days", length: 3 }, promotion: { unit: "weeks", length: 4 } }, now);
    expect(fresh).toMatchObject({ modelVersion: 2, version: 1, enabled: true, dailyTarget: 6_000_000, leewayPct: 0, allowedMissedDays: 1, demotion: { unit: "days", length: 3 }, promotion: { unit: "weeks", length: 4 } });
    const upgraded = mergeVsPolicyPatch(legacy, { modelVersion: 2, allowedMissedDays: 2 }, now);
    expect(upgraded).toMatchObject({ modelVersion: 2, version: 2, enabled: true, dailyTarget: 7_200_000, allowedMissedDays: 2, demotion: { unit: "weeks", length: 1 } });
    expect(upgraded).not.toHaveProperty("weeklyMinimum");
    expect(upgraded).not.toHaveProperty("preset");
    expect(upgraded).not.toHaveProperty("removalThreshold");
  });

  it("patches a v2 policy in place and keeps the model pinned", () => {
    const v2 = mergeVsPolicyPatch(null, { modelVersion: 2, enabled: true, demotion: { unit: "days", length: 3 } }, now);
    const next = mergeVsPolicyPatch(v2, { allowedMissedDays: 1 }, now);
    expect(next).toMatchObject({ modelVersion: 2, version: 2, allowedMissedDays: 1, demotion: { unit: "days", length: 3 } });
  });

  it.each([
    { modelVersion: 2, dailyTarget: 0 },
    { modelVersion: 2, dailyTarget: Number.MAX_SAFE_INTEGER + 1 },
    { modelVersion: 2, leewayPct: -1 },
    { modelVersion: 2, leewayPct: 101 },
    { modelVersion: 2, leewayPct: 0.5 },
    { modelVersion: 2, allowedMissedDays: -1 },
    { modelVersion: 2, allowedMissedDays: 6 },
    { modelVersion: 2, allowedMissedDays: 1.5 },
    { modelVersion: 2, enabled: "true" },
    { modelVersion: 2, demotion: { unit: "months", length: 1 } },
    { modelVersion: 2, demotion: { unit: "days", length: 0 } },
    { modelVersion: 2, demotion: { unit: "days", length: 313 } },
    { modelVersion: 2, demotion: { unit: "weeks", length: 53 } },
    { modelVersion: 2, demotion: { unit: "days", length: 2, extra: true } },
    { modelVersion: 2, demotion: { length: 2 } },
    { modelVersion: 2, weeklyMinimum: 40_000_000 },
    { modelVersion: 2, preset: "rank_aware" },
    { modelVersion: 2, removalThreshold: 3 },
    { modelVersion: 2, unexpected: true },
    { modelVersion: 3 },
  ])("rejects out-of-bounds, legacy-only, or unknown v2 patch %j", (patch) => {
    expect(() => mergeVsPolicyPatch(null, patch, now)).toThrow("invalid_policy");
  });

  it("rejects downgrading a v2 policy or sending legacy-only keys against it", () => {
    const v2 = mergeVsPolicyPatch(null, { modelVersion: 2, enabled: true }, now);
    expect(() => mergeVsPolicyPatch(v2, { modelVersion: 1 }, now)).toThrow("invalid_policy");
    expect(() => mergeVsPolicyPatch(v2, { weeklyMinimum: 40_000_000 }, now)).toThrow("invalid_policy");
    expect(() => mergeVsPolicyPatch(v2, { preset: "consecutive" }, now)).toThrow("invalid_policy");
  });

  it("keeps legacy v1 patches working unchanged when the previous policy is v1 or absent", () => {
    expect(mergeVsPolicyPatch(null, { weeklyMinimum: 40_000_000 }, now)).toMatchObject({ modelVersion: 1, weeklyMinimum: 40_000_000, preset: "rank_aware" });
    expect(mergeVsPolicyPatch(legacy, { modelVersion: 1, leewayPct: 10 }, now)).toMatchObject({ modelVersion: 1, leewayPct: 10, version: 2 });
    expect(mergeVsPolicyPatch(legacy, { removalThreshold: 4 }, now)).toMatchObject({ removalThreshold: 4, weeklyMinimum: 40_000_000 });
  });
});
