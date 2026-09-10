import { describe, expect, it } from "vitest";
import { evaluateVsWeek, mergeVsDailySources, parseVsScore, validateVsPeriod, type VsEvidence } from "./evidence.shared";

const sunday = "2026-09-06";
const daily = (day: number, score = 7_200_000): VsEvidence => ({ id: `day-${day}`, recordedDate: `2026-09-0${day}`, period: "daily", score });
const weekDays: VsEvidence[] = [
  { id: "monday", recordedDate: "2026-08-31", period: "daily", score: 7_200_000 },
  ...[1, 2, 3, 4, 5].map((day) => daily(day)),
];
const weekly: VsEvidence = { id: "weekly", recordedDate: sunday, period: "weekly", score: 43_200_000 };

describe("canonical VS values", () => {
  it.each(["", " ", "not a score", "-1", "1.5", "1,2", "Infinity", "9007199254740992"])("rejects %j rather than turning it into zero", (value) => {
    expect(() => parseVsScore(value)).toThrow();
  });
  it("preserves explicit zeroes and exact integer scores", () => {
    expect(parseVsScore("0")).toBe(0);
    expect(parseVsScore("7,200,000")).toBe(7_200_000);
    expect(parseVsScore("7200000")).toBe(7_200_000);
    expect(parseVsScore("7.200.000")).toBe(7_200_000);
    expect(parseVsScore("7 200 000")).toBe(7_200_000);
  });
  it("requires valid match dates and Sunday weekly dates", () => {
    expect(validateVsPeriod("2026-09-05", "daily")).toBe(true);
    expect(validateVsPeriod(sunday, "weekly")).toBe(true);
    expect(validateVsPeriod(sunday, "daily")).toBe(false);
    expect(validateVsPeriod("2026-09-05", "weekly")).toBe(false);
    expect(validateVsPeriod("2026-02-30", "daily")).toBe(false);
  });
});

describe("daily source priority", () => {
  it("prefers explicit upstream Saturday over an unowned local derivation", () => {
    expect(mergeVsDailySources([{ memberId: "m", score: 12, origin: "derived" }], new Map([["m", 18]])).get("m")).toBe(18);
    expect(mergeVsDailySources([{ memberId: "m", score: 14, origin: "derived" }], new Map([["m", 12]]), { m: { previous: 8, desired: 12 } }).get("m")).toBe(14);
  });
  it("does not resurrect stale replicas after raw or derived evidence is deleted", () => {
    expect(mergeVsDailySources([{ memberId: "m", score: null, origin: "hq" }], new Map([["m", 12]])).has("m")).toBe(false);
    expect(mergeVsDailySources([{ memberId: "m", score: null, origin: "derived" }], new Map([["m", 12]]), { m: { previous: 8, desired: 12 } }).has("m")).toBe(false);
    expect(mergeVsDailySources([{ memberId: "m", score: 0, origin: "hq" }], new Map([["m", 12]])).get("m")).toBe(0);
  });
});

describe("weekly VS evidence", () => {
  it("uses an accepted weekly total even without daily uploads", () => {
    expect(evaluateVsWeek([weekly], sunday)).toMatchObject({ state: "ready", score: 43_200_000, source: "weekly", dailyCoverage: 0 });
  });
  it("never interprets absent or partial daily evidence as a zero or complete week", () => {
    expect(evaluateVsWeek([], sunday)).toMatchObject({ state: "missing", score: null });
    expect(evaluateVsWeek(weekDays.slice(0, 5), sunday)).toMatchObject({ state: "partial", score: null, dailyCoverage: 5 });
  });
  it("falls back only to six complete daily observations", () => {
    expect(evaluateVsWeek(weekDays, sunday)).toMatchObject({ state: "ready", score: 43_200_000, source: "daily", dailyCoverage: 6 });
    expect(evaluateVsWeek(weekDays.map((row) => ({ ...row, score: 0 })), sunday)).toMatchObject({ state: "ready", score: 0 });
  });
  it("derives Saturday only from weekly minus complete Monday–Friday data", () => {
    expect(evaluateVsWeek([weekly, ...weekDays.slice(0, 5)], sunday).derivedSaturday).toMatchObject({ score: 7_200_000, basis: expect.arrayContaining(["weekly", "monday"]) });
    expect(evaluateVsWeek([weekly, ...weekDays.slice(0, 4)], sunday).derivedSaturday).toBeNull();
  });
  it("keeps explicit Saturday and reports inconsistent or negative derivations", () => {
    expect(evaluateVsWeek([weekly, ...weekDays], sunday).derivedSaturday).toBeNull();
    expect(evaluateVsWeek([{ ...weekly, score: 1 }, ...weekDays.slice(0, 5)], sunday).state).toBe("conflict");
    expect(evaluateVsWeek([{ ...weekly, score: 50_000_000 }, ...weekDays], sunday).state).toBe("conflict");
  });
  it("does not choose the maximum of conflicting duplicate rows", () => {
    expect(evaluateVsWeek([weekly, { ...weekly, id: "other", score: 99_000_000 }], sunday).state).toBe("conflict");
    expect(evaluateVsWeek([...weekDays, { ...weekDays[0], id: "other", score: 1 }], sunday).state).toBe("conflict");
  });
  it("ignores other weeks and invalidates a derived Saturday when dependencies disappear", () => {
    expect(evaluateVsWeek([{ ...weekly, recordedDate: "2026-09-13" }], sunday).state).toBe("missing");
    expect(evaluateVsWeek(weekDays.slice(0, 5), sunday).derivedSaturday).toBeNull();
  });
});
