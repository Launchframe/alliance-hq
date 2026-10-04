import { describe, expect, it } from "vitest";
import { evaluateVsWeek } from "@/lib/vs-scores/evidence.shared";
import { rebuildVsCompliance, recommendVsPenalty } from "./evaluate.shared";
import { defaultVsPolicy } from "./policy.shared";
import type { VsComplianceMember, VsComplianceWeek, VsPolicyVersion } from "./types.shared";

const policy: VsPolicyVersion = { ...defaultVsPolicy(), enabled: true, weeklyMinimum: 40_000_000, effectiveWeek: "2026-09-13", version: 1 };
const member: VsComplianceMember = { active: true, joinedAt: "2026-09-01T02:00:00.000Z", leftAt: null, currentRank: 3, rankVersion: "rank-1", isOwner: false };
const now = new Date("2026-10-05T12:00:00.000Z");
function week(weekEnding = "2026-09-13", score = 10_000_000): VsComplianceWeek {
  return { weekEnding, evidence: evaluateVsWeek([{ id: `weekly:${weekEnding}:${score}`, recordedDate: weekEnding, period: "weekly", score }], weekEnding), excused: false, pendingExcusal: false, waived: false };
}
function rebuild(weeks: VsComplianceWeek[], policies = [policy], roster = member) {
  return rebuildVsCompliance({ weeks, policies, member: roster, now });
}

describe("VS recommendations", () => {
  it.each([[3, "demote", 2], [2, "demote", 1], [1, "remove", null], [4, "demote", 3], [5, "leadership_review", null]] as const)("rank-aware R%s uses current rank", (rank, kind, targetRank) => {
    expect(recommendVsPenalty({ ...member, currentRank: rank }, policy, 1)).toEqual({ kind, targetRank });
  });

  it.each([[3, 1, "demote", 2], [3, 2, "demote", 1], [3, 3, "remove", null], [1, 1, "none", null], [1, 2, "none", null], [1, 3, "remove", null], [2, 1, "none", null], [4, 1, "demote", 2], [5, 3, "leadership_review", null]] as const)("consecutive rank %s miss %s never promotes", (rank, streak, kind, targetRank) => {
    expect(recommendVsPenalty({ ...member, currentRank: rank }, { ...policy, preset: "consecutive" }, streak)).toEqual({ kind, targetRank });
  });

  it("honors a configurable removal threshold without inventing additional demotions at R1", () => {
    expect(recommendVsPenalty({ ...member, currentRank: 1 }, { ...policy, preset: "consecutive", removalThreshold: 5 }, 4)).toEqual({ kind: "none", targetRank: null });
    expect(recommendVsPenalty({ ...member, currentRank: 1 }, { ...policy, preset: "consecutive", removalThreshold: 5 }, 5).kind).toBe("remove");
  });

  it("always routes owner and unknown-rank problems to leadership review", () => {
    expect(recommendVsPenalty({ ...member, isOwner: true, currentRank: 1 }, policy, 4).kind).toBe("leadership_review");
    expect(recommendVsPenalty({ ...member, currentRank: null }, policy, 1).kind).toBe("leadership_review");
  });
});

describe("chronological conservative evaluation", () => {
  it("uses Sunday weekly evidence, never a daily benchmark as the weekly requirement", () => {
    const result = rebuild([week("2026-09-13", 39_999_999)])[0];
    expect(result).toMatchObject({ outcome: "missed", threshold: 40_000_000, streak: 1, recommendation: { kind: "demote", targetRank: 2 } });
    expect(rebuild([week("2026-09-13", 40_000_000)])[0].outcome).toBe("passed");
  });

  it.each(["missing", "partial", "conflict"] as const)("%s data never becomes zero or a miss", (state) => {
    const input = week();
    input.evidence = { ...input.evidence, state, score: null };
    expect(rebuild([input])[0]).toMatchObject({ outcome: "pending_data", streak: null, recommendation: { kind: "none" } });
  });

  it("explicit zero is a verified miss while malformed ready evidence is pending", () => {
    expect(rebuild([week("2026-09-13", 0)])[0].outcome).toBe("missed");
    const malformed = week();
    malformed.evidence.score = null;
    expect(rebuild([malformed])[0].outcome).toBe("pending_data");
    const unproven = week();
    unproven.evidence.basis = [];
    expect(rebuild([unproven])[0].outcome).toBe("pending_data");
    unproven.evidence = { ...week().evidence, source: "daily", dailyCoverage: 5 };
    expect(rebuild([unproven])[0].outcome).toBe("pending_data");
  });

  it("a timely excused VS day exempts the entire week, even without scores", () => {
    const input = week();
    input.evidence = evaluateVsWeek([], input.weekEnding);
    expect(rebuild([{ ...input, excused: true }])[0]).toMatchObject({ outcome: "excused", streak: 0 });
  });

  it("unverified excuse evidence pauses an otherwise adverse result but not a pass", () => {
    expect(rebuild([{ ...week(), pendingExcusal: true }])[0].outcome).toBe("pending_data");
    expect(rebuild([{ ...week("2026-09-13", 40_000_000), pendingExcusal: true }])[0].outcome).toBe("passed");
  });

  it.each(["passed", "excused", "waived"] as const)("%s resets streak without restoring rank", (outcome) => {
    const reset = { ...week("2026-09-20", outcome === "passed" ? 40_000_000 : 1), excused: outcome === "excused", waived: outcome === "waived" };
    const results = rebuild([week(), reset, week("2026-09-27")], [policy], { ...member, currentRank: 1 });
    expect(results.map((row) => row.streak)).toEqual([1, 0, 1]);
    expect(results[2].recommendation.kind).toBe("remove");
  });

  it("holds escalation across unknown or omitted intervening weeks until a known reset", () => {
    const unknown = week("2026-09-20");
    unknown.evidence = evaluateVsWeek([], unknown.weekEnding);
    expect(rebuild([week(), unknown, week("2026-09-27")])[2]).toMatchObject({ outcome: "missed", streak: null, recommendation: { kind: "none" } });
    expect(rebuild([week(), week("2026-09-27")])[1].streak).toBeNull();
    expect(rebuild([week("2026-09-20")])[0].streak).toBeNull();
    const reset = { ...week("2026-09-27"), waived: true };
    expect(rebuild([week(), unknown, reset, week("2026-10-04")])[3].streak).toBe(1);
  });

  it("rebuilds later ladder recommendations after waiver or corrected scores", () => {
    const consecutive: VsPolicyVersion = { ...policy, preset: "consecutive" };
    const initial = [week(), week("2026-09-20"), week("2026-09-27")];
    expect(rebuild(initial, [consecutive])[2].recommendation.kind).toBe("remove");
    for (const corrected of [{ ...initial[1], waived: true }, week("2026-09-20", 40_000_000)]) {
      const rebuilt = rebuild([initial[0], corrected, initial[2]], [consecutive]);
      expect(rebuilt[2]).toMatchObject({ streak: 1, recommendation: { kind: "demote", targetRank: 2 } });
      expect(rebuilt[2].evaluationBasis).not.toBe(rebuild(initial, [consecutive])[2].evaluationBasis);
    }
  });

  it("does not simulate successive rank reductions for multiple unhandled weeks", () => {
    expect(rebuild([week(), week("2026-09-20")]).map((row) => row.recommendation.targetRank)).toEqual([2, 2]);
  });

  it("manual promotion changes starting rank and invalidates the confirmation basis", () => {
    const before = rebuild([week()], [policy], { ...member, currentRank: 1 });
    const after = rebuild([week()], [policy], { ...member, currentRank: 2, rankVersion: "promotion-2" });
    expect(after[0].recommendation).toEqual({ kind: "demote", targetRank: 1 });
    expect(after[0].confirmationBasis).not.toBe(before[0].confirmationBasis);
    expect(after[0].evaluationBasis).toBe(before[0].evaluationBasis);
  });

  it("retains settled actions as facts and flags corrected evaluation for review", () => {
    const original = rebuild([week()])[0];
    const settled = { actionId: "action-1", evaluationBasis: original.evaluationBasis, kind: "demote" as const, targetRank: 2 };
    const unchanged = rebuild([{ ...week(), settled }], [policy], { ...member, currentRank: 2, rankVersion: "action-1" })[0];
    expect(unchanged).toMatchObject({ settled, correctionReview: false, recommendation: { kind: "none" } });
    const corrected = rebuild([{ ...week("2026-09-13", 40_000_000), settled }])[0];
    expect(corrected).toMatchObject({ settled, correctionReview: true, outcome: "passed", recommendation: { kind: "none" } });
  });

  it.each([
    { active: false }, { joinedAt: null }, { joinedAt: "2026-09-07T02:00:00.001Z" },
    { leftAt: "2026-09-13T01:59:59.999Z" },
  ])("skips departed, unknown-tenure and partial-week members %j", (changes) => {
    expect(rebuild([week()], [policy], { ...member, ...changes })[0].outcome).toBe("not_eligible");
  });

  it("does not reuse an earlier stint for a rejoined current member", () => {
    const result = rebuild([week(), week("2026-09-20"), week("2026-09-27")], [policy], { ...member, joinedAt: "2026-09-15T02:00:00.000Z" });
    expect(result.map((row) => row.outcome)).toEqual(["not_eligible", "not_eligible", "missed"]);
    expect(result[2].streak).toBe(1);
  });

  it("does not evaluate an unfinished week or a week before explicit policy activation", () => {
    expect(rebuildVsCompliance({ weeks: [week()], policies: [policy], member, now: new Date("2026-09-13T01:59:59.999Z") })[0].outcome).toBe("not_eligible");
    expect(rebuild([week()], [])[0].outcome).toBe("not_eligible");
    expect(rebuild([week()], [{ ...policy, enabled: false }])[0].outcome).toBe("not_eligible");
    expect(rebuild([week()], [{ ...policy, effectiveWeek: "2026-09-20" }])[0].outcome).toBe("not_eligible");
  });

  it("historical policy versions remain authoritative and policy changes alter confirmation basis", () => {
    const later = { ...policy, version: 2, effectiveWeek: "2026-09-20", weeklyMinimum: 60_000_000 };
    const results = rebuild([week("2026-09-13", 45_000_000), week("2026-09-20", 45_000_000)], [later, policy]);
    expect(results.map((row) => row.outcome)).toEqual(["passed", "missed"]);
    expect(results.map((row) => row.policyVersion)).toEqual([1, 2]);
  });

  it("canonicalizes evidence provenance ordering and rejects duplicate or invalid week identities", () => {
    const original = week();
    original.evidence.basis = ["b", "a"];
    const reordered = { ...original, evidence: { ...original.evidence, basis: ["a", "b"] } };
    expect(rebuild([original])[0].confirmationBasis).toBe(rebuild([reordered])[0].confirmationBasis);
    expect(() => rebuild([week(), week()])).toThrow("invalid_week");
    expect(() => rebuild([{ ...week(), weekEnding: "2026-09-14" }])).toThrow("invalid_week");
  });
});
