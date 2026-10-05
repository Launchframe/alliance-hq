import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addCalendarDays } from "@/lib/trains/game-time";
import { evaluateVsWeek } from "@/lib/vs-scores/evidence.shared";
import { rebuildVsCompliance, recommendVsPenalty } from "./evaluate.shared";
import { defaultVsPolicy, defaultVsDailyPolicy } from "./policy.shared";
import type { VsComplianceDay, VsComplianceMember, VsComplianceWeek, VsDailyPolicyVersion, VsPolicyVersion } from "./types.shared";

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

  it("golden: captures exact v1 outcomes, streaks, recommendations and basis digests across a varied history", () => {
    const digest = (basis: string) => createHash("sha256").update(JSON.stringify(basis)).digest("hex");
    const pending = week("2026-10-25");
    pending.evidence = evaluateVsWeek([], pending.weekEnding);
    const weeks = [
      week("2026-09-13", 39_999_999),
      week("2026-09-20"),
      week("2026-09-27", 40_000_000),
      { ...week("2026-10-04"), excused: true },
      week("2026-10-18"),
      pending,
      { ...week("2026-11-01"), waived: true },
      week("2026-11-08"),
    ];
    const later = new Date("2026-11-15T12:00:00.000Z");
    const results = rebuildVsCompliance({ weeks, policies: [policy], member, now: later, digest });
    expect(results.map((row) => [row.outcome, row.streak, row.recommendation.kind, row.recommendation.targetRank])).toEqual([
      ["missed", 1, "demote", 2],
      ["missed", 2, "demote", 2],
      ["passed", 0, "none", null],
      ["excused", 0, "none", null],
      ["missed", null, "none", null],
      ["pending_data", null, "none", null],
      ["waived", 0, "none", null],
      ["missed", 1, "demote", 2],
    ]);
    expect(results.map((row) => [row.evaluationBasis, row.confirmationBasis])).toMatchInlineSnapshot(`
      [
        [
          "e0a7d75e955c98073dabbb50a4be47e873e18228bc3b1447afa7a04e83c15f67",
          "{"evaluationBasis":"e0a7d75e955c98073dabbb50a4be47e873e18228bc3b1447afa7a04e83c15f67","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"demote","targetRank":2}}",
        ],
        [
          "0fbdd0b30a73a021371fa692819e99119e3959787dcfb26c72eb93196249f711",
          "{"evaluationBasis":"0fbdd0b30a73a021371fa692819e99119e3959787dcfb26c72eb93196249f711","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"demote","targetRank":2}}",
        ],
        [
          "5a071865f849df8114a525a6402faf0035666a86c4062932aa0e791bf5762086",
          "{"evaluationBasis":"5a071865f849df8114a525a6402faf0035666a86c4062932aa0e791bf5762086","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "759c05fe3a87fc1fffb5e93039f5626fa59d9bc14f54eadc057e9b96a2c171b7",
          "{"evaluationBasis":"759c05fe3a87fc1fffb5e93039f5626fa59d9bc14f54eadc057e9b96a2c171b7","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "d3254178b561c1fbcdd6c7a43433894f31526d7b22a58db2a39fc9b2530090f6",
          "{"evaluationBasis":"d3254178b561c1fbcdd6c7a43433894f31526d7b22a58db2a39fc9b2530090f6","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "ca230f5b6ba5d57cd0c87d07bbb96af3bf779d325b0652c4d0197ef31bca4bee",
          "{"evaluationBasis":"ca230f5b6ba5d57cd0c87d07bbb96af3bf779d325b0652c4d0197ef31bca4bee","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "9b4904db2a098e205d830fc8fd3d6f9040a6144040fae55e876a7cdb2c655a72",
          "{"evaluationBasis":"9b4904db2a098e205d830fc8fd3d6f9040a6144040fae55e876a7cdb2c655a72","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "94a1edbff4f9e5384aab38b74358d57dd950564b0530a069339391ba1ef11efd",
          "{"evaluationBasis":"94a1edbff4f9e5384aab38b74358d57dd950564b0530a069339391ba1ef11efd","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"demote","targetRank":2}}",
        ],
      ]
    `);
    const undigested = rebuildVsCompliance({ weeks, policies: [policy], member, now: later });
    expect(undigested.map((row) => [row.evaluationBasis, row.confirmationBasis])).toMatchInlineSnapshot(`
      [
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-09-13\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",39999999,\\"weekly\\",0,[\\"weekly:2026-09-13:39999999\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"missed\\"}","historyBasis":[],"streak":1}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-09-13\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",39999999,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-09-13:39999999\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"missed\\\\\\"}\\",\\"historyBasis\\":[],\\"streak\\":1}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"demote","targetRank":2}}",
        ],
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-09-20\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-09-20:10000000\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"missed\\"}","historyBasis":["{\\"weekEnding\\":\\"2026-09-13\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",39999999,\\"weekly\\",0,[\\"weekly:2026-09-13:39999999\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"missed\\"}"],"streak":2}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-09-20\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-09-20:10000000\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"missed\\\\\\"}\\",\\"historyBasis\\":[\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-09-13\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",39999999,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-09-13:39999999\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"missed\\\\\\"}\\"],\\"streak\\":2}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"demote","targetRank":2}}",
        ],
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-09-27\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",40000000,\\"weekly\\",0,[\\"weekly:2026-09-27:40000000\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"passed\\"}","historyBasis":[],"streak":0}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-09-27\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",40000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-09-27:40000000\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"passed\\\\\\"}\\",\\"historyBasis\\":[],\\"streak\\":0}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-10-04\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-10-04:10000000\\"]],\\"excused\\":true,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"excused\\"}","historyBasis":[],"streak":0}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-10-04\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-10-04:10000000\\\\\\"]],\\\\\\"excused\\\\\\":true,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"excused\\\\\\"}\\",\\"historyBasis\\":[],\\"streak\\":0}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-10-18\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-10-18:10000000\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"missed\\"}","historyBasis":["{\\"weekEnding\\":\\"2026-10-04\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-10-04:10000000\\"]],\\"excused\\":true,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"excused\\"}","{\\"gapAfter\\":\\"2026-10-04\\",\\"before\\":\\"2026-10-18\\"}"],"streak":null}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-10-18\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-10-18:10000000\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"missed\\\\\\"}\\",\\"historyBasis\\":[\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-10-04\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-10-04:10000000\\\\\\"]],\\\\\\"excused\\\\\\":true,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"excused\\\\\\"}\\",\\"{\\\\\\"gapAfter\\\\\\":\\\\\\"2026-10-04\\\\\\",\\\\\\"before\\\\\\":\\\\\\"2026-10-18\\\\\\"}\\"],\\"streak\\":null}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-10-25\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"missing\\",null,null,0,[]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"pending_data\\"}","historyBasis":["{\\"weekEnding\\":\\"2026-10-04\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-10-04:10000000\\"]],\\"excused\\":true,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"excused\\"}","{\\"gapAfter\\":\\"2026-10-04\\",\\"before\\":\\"2026-10-18\\"}","{\\"weekEnding\\":\\"2026-10-18\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-10-18:10000000\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"missed\\"}"],"streak":null}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-10-25\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"missing\\\\\\",null,null,0,[]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"pending_data\\\\\\"}\\",\\"historyBasis\\":[\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-10-04\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-10-04:10000000\\\\\\"]],\\\\\\"excused\\\\\\":true,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"excused\\\\\\"}\\",\\"{\\\\\\"gapAfter\\\\\\":\\\\\\"2026-10-04\\\\\\",\\\\\\"before\\\\\\":\\\\\\"2026-10-18\\\\\\"}\\",\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-10-18\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-10-18:10000000\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"missed\\\\\\"}\\"],\\"streak\\":null}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-11-01\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-11-01:10000000\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":true,\\"outcome\\":\\"waived\\"}","historyBasis":[],"streak":0}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-11-01\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-11-01:10000000\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":true,\\\\\\"outcome\\\\\\":\\\\\\"waived\\\\\\"}\\",\\"historyBasis\\":[],\\"streak\\":0}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}",
        ],
        [
          "{"ownBasis":"{\\"weekEnding\\":\\"2026-11-08\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-11-08:10000000\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":false,\\"outcome\\":\\"missed\\"}","historyBasis":["{\\"weekEnding\\":\\"2026-11-01\\",\\"policy\\":[1,\\"2026-09-13\\",true,7200000,40000000,0,\\"rank_aware\\",3],\\"membership\\":[\\"2026-09-01T02:00:00.000Z\\",null],\\"evidence\\":[\\"ready\\",10000000,\\"weekly\\",0,[\\"weekly:2026-11-01:10000000\\"]],\\"excused\\":false,\\"pendingExcusal\\":false,\\"waived\\":true,\\"outcome\\":\\"waived\\"}"],"streak":1}",
          "{"evaluationBasis":"{\\"ownBasis\\":\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-11-08\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-11-08:10000000\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":false,\\\\\\"outcome\\\\\\":\\\\\\"missed\\\\\\"}\\",\\"historyBasis\\":[\\"{\\\\\\"weekEnding\\\\\\":\\\\\\"2026-11-01\\\\\\",\\\\\\"policy\\\\\\":[1,\\\\\\"2026-09-13\\\\\\",true,7200000,40000000,0,\\\\\\"rank_aware\\\\\\",3],\\\\\\"membership\\\\\\":[\\\\\\"2026-09-01T02:00:00.000Z\\\\\\",null],\\\\\\"evidence\\\\\\":[\\\\\\"ready\\\\\\",10000000,\\\\\\"weekly\\\\\\",0,[\\\\\\"weekly:2026-11-01:10000000\\\\\\"]],\\\\\\"excused\\\\\\":false,\\\\\\"pendingExcusal\\\\\\":false,\\\\\\"waived\\\\\\":true,\\\\\\"outcome\\\\\\":\\\\\\"waived\\\\\\"}\\"],\\"streak\\":1}","rank":3,"rankVersion":"rank-1","active":true,"isOwner":false,"recommendation":{"kind":"demote","targetRank":2}}",
        ],
      ]
    `);
    const consecutive: VsPolicyVersion = { ...policy, preset: "consecutive" };
    const alt = rebuildVsCompliance({ weeks, policies: [consecutive], member: { ...member, currentRank: 1 }, now: later, digest });
    expect(alt.map((row) => [row.outcome, row.streak, row.recommendation.kind, row.recommendation.targetRank])).toEqual([
      ["missed", 1, "none", null],
      ["missed", 2, "none", null],
      ["passed", 0, "none", null],
      ["excused", 0, "none", null],
      ["missed", null, "none", null],
      ["pending_data", null, "none", null],
      ["waived", 0, "none", null],
      ["missed", 1, "none", null],
    ]);
    expect(alt.map((row) => row.evaluationBasis)).toMatchInlineSnapshot(`
      [
        "75fee4c310346de876585ff0269b8575660935a3682269c056cc3b4cb5a78670",
        "4ad09accd1fc2038be86c5023e1e21572941054414e1efd2fa7370924af4ab1b",
        "f310000b54c6d40164aae7124d72b25e9d09cf79ca4be74e94210d00a164826a",
        "e22a6453c2fd35fc76081bd33bdcdbc3cd2aeca313811337f3f0e07a7bdc4ed9",
        "715bac6f5687ad87ad5fb783e94e32c9e881bd269b7854512f8374637bbab109",
        "27d71b81e62c64b27828716fbfeba243ebdba9a64c9197568b15158e55b6d72b",
        "c82d4261579d72a69434331081e785d93dcc147d114339503a3a4c45c75e0217",
        "ec73cd3b145d49db931864352a962841e6447a270e5d32f0558a736677cdc954",
      ]
    `);
  });

  it("golden: settled actions and correction review keep exact v1 basis behavior", () => {
    const digest = (basis: string) => createHash("sha256").update(JSON.stringify(basis)).digest("hex");
    const lateMember: VsComplianceMember = { ...member, joinedAt: "2026-11-02T02:00:00.000Z" };
    const base = week("2026-11-08");
    const original = rebuildVsCompliance({ weeks: [base], policies: [policy], member: lateMember, now: new Date("2026-11-15T12:00:00.000Z"), digest })[0];
    const settled = { actionId: "action-9", evaluationBasis: original.evaluationBasis, kind: "demote" as const, targetRank: 2 };
    const unchanged = rebuildVsCompliance({ weeks: [{ ...base, settled }], policies: [policy], member: { ...lateMember, currentRank: 2, rankVersion: "action-9" }, now: new Date("2026-11-15T12:00:00.000Z"), digest })[0];
    expect(unchanged).toMatchObject({ outcome: "missed", streak: 1, correctionReview: false, recommendation: { kind: "none" }, settled });
    expect(unchanged.evaluationBasis).toMatchInlineSnapshot(`"8c10a3c26cbb6861fd7340d045f93a488f291df93cef48a6dfcd291b32e92016"`);
    expect(unchanged.confirmationBasis).toMatchInlineSnapshot(`"{"evaluationBasis":"8c10a3c26cbb6861fd7340d045f93a488f291df93cef48a6dfcd291b32e92016","rank":2,"rankVersion":"action-9","active":true,"isOwner":false,"recommendation":{"kind":"none","targetRank":null}}"`);
    const corrected = rebuildVsCompliance({ weeks: [{ ...week("2026-11-08", 40_000_000), settled }], policies: [policy], member: lateMember, now: new Date("2026-11-15T12:00:00.000Z"), digest })[0];
    expect(corrected).toMatchObject({ outcome: "passed", streak: 0, correctionReview: true, recommendation: { kind: "none" } });
    expect(corrected.evaluationBasis).toMatchInlineSnapshot(`"6dd0647c442fc85d8176548d43ae2d49af2ff3df58a9ee29c34d0f943b7677b9"`);
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

describe("daily consistency model (v2)", () => {
  const v2Now = new Date("2026-11-20T12:00:00.000Z");
  function v2Policy(overrides: Partial<VsDailyPolicyVersion> = {}): VsDailyPolicyVersion {
    return { ...defaultVsDailyPolicy(), enabled: true, dailyTarget: 8_000_000, effectiveWeek: "2026-09-13", version: 1, ...overrides };
  }
  type DaySpec = number | "missing" | "excused" | "pending" | "conflict" | "partial";
  function v2Week(weekEnding: string, specs: DaySpec[], overrides: Partial<VsComplianceWeek> = {}): VsComplianceWeek {
    const days: VsComplianceDay[] = specs.map((spec, index) => {
      const date = addCalendarDays(weekEnding, index - 6);
      const base: VsComplianceDay = { date, score: null, state: "ready", source: "hq", sourceReady: true, away: false, excused: false, pendingExcusal: false };
      if (spec === "missing") return { ...base, state: "missing", source: null, sourceReady: false };
      if (spec === "conflict") return { ...base, state: "conflict" };
      if (spec === "partial") return { ...base, state: "partial" };
      if (spec === "excused") return { ...base, excused: true };
      if (spec === "pending") return { ...base, pendingExcusal: true };
      return { ...base, score: spec };
    });
    const records = days.filter((day) => day.state === "ready" && day.score !== null).map((day) => ({ id: `hq:${day.date}:${day.score}`, recordedDate: day.date, period: "daily" as const, score: day.score! }));
    return { weekEnding, evidence: evaluateVsWeek(records, weekEnding), excused: days.every((day) => day.excused), pendingExcusal: days.some((day) => day.pendingExcusal), waived: false, days, ...overrides };
  }
  const allMet: DaySpec[] = [8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000];
  const v2 = (weeks: VsComplianceWeek[], policies: VsPolicyVersion[], roster = member, extra: { now?: Date; consumedThrough?: string | null } = {}) =>
    rebuildVsCompliance({ weeks, policies, member: roster, now: extra.now ?? v2Now, consumedThrough: extra.consumedThrough });

  it("passes six met days and reports full counts", () => {
    const result = v2([v2Week("2026-09-13", allMet)], [v2Policy()])[0];
    expect(result).toMatchObject({ outcome: "passed", modelVersion: 2, streak: 0, recommendation: { kind: "none" } });
    expect(result.counts).toEqual({ required: 6, met: 6, missed: 0, excused: 0, unknown: 0 });
    expect(result.days).toHaveLength(6);
    expect(result.threshold).toBe(8_000_000);
    expect(result.sequence?.promotion.progress).toBe(1);
  });

  it("one miss fails under zero allowance but passes under allowance one", () => {
    const oneMiss: DaySpec[] = [8_000_000, 7_999_999, 8_000_000, 8_000_000, 8_000_000, 8_000_000];
    expect(v2([v2Week("2026-09-13", oneMiss)], [v2Policy()])[0].outcome).toBe("missed");
    const lenient = v2([v2Week("2026-09-13", oneMiss)], [v2Policy({ allowedMissedDays: 1 })])[0];
    expect(lenient).toMatchObject({ outcome: "passed", streak: 0 });
    expect(lenient.counts).toMatchObject({ missed: 1, met: 5 });
    expect(lenient.days?.[1].assessment).toBe("missed");
  });

  it("five explicit zero days plus a huge Saturday still fail daily consistency", () => {
    const spike: DaySpec[] = [0, 0, 0, 0, 0, 200_000_000];
    const result = v2([v2Week("2026-09-13", spike)], [v2Policy()])[0];
    expect(result).toMatchObject({ outcome: "missed", score: 200_000_000 });
    expect(result.counts).toMatchObject({ missed: 5, met: 1 });
  });

  it("distinguishes an explicit ready zero (missed) from unknown data (pending)", () => {
    const zero = v2([v2Week("2026-09-13", [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000])], [v2Policy()])[0];
    expect(zero.days?.[0]).toMatchObject({ assessment: "missed", score: 0 });
    for (const state of ["missing", "conflict", "partial"] as const) {
      const result = v2([v2Week("2026-09-13", [state, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000])], [v2Policy()])[0];
      expect(result).toMatchObject({ outcome: "pending_data" });
      expect(result.days?.[0].assessment).toBe("unknown");
      expect(result.counts?.unknown).toBe(1);
    }
  });

  it("meets exactly at the daily threshold and applies leeway with exact ceiling rounding", () => {
    expect(v2([v2Week("2026-09-13", allMet)], [v2Policy()])[0].outcome).toBe("passed");
    expect(v2([v2Week("2026-09-13", [7_999_999, ...allMet.slice(1)])], [v2Policy()])[0].outcome).toBe("missed");
    const leeway = v2Policy({ dailyTarget: 8_000_001, leewayPct: 10 });
    expect(v2([v2Week("2026-09-13", [7_200_001, ...allMet.slice(1)])], [leeway])[0].outcome).toBe("passed");
    expect(v2([v2Week("2026-09-13", [7_200_000, ...allMet.slice(1)])], [leeway])[0].outcome).toBe("missed");
  });

  it("does not enforce a disabled or absent policy", () => {
    expect(v2([v2Week("2026-09-13", allMet)], [v2Policy({ enabled: false })])[0].outcome).toBe("not_eligible");
    expect(v2([v2Week("2026-09-13", allMet)], [])[0].outcome).toBe("not_eligible");
    expect(v2([v2Week("2026-09-13", allMet)], [v2Policy({ effectiveWeek: "2026-09-20" })])[0].outcome).toBe("not_eligible");
  });

  it("passes a week with partial excusal and excuses a fully excused week", () => {
    const partial = v2([v2Week("2026-09-13", [8_000_000, 8_000_000, "excused", 8_000_000, 8_000_000, 8_000_000])], [v2Policy()])[0];
    expect(partial).toMatchObject({ outcome: "passed" });
    expect(partial.counts).toMatchObject({ required: 5, excused: 1 });
    const full = v2([v2Week("2026-09-13", ["excused", "excused", "excused", "excused", "excused", "excused"])], [v2Policy()])[0];
    expect(full).toMatchObject({ outcome: "excused", streak: 0 });
    expect(full.sequence?.demotion.progress).toBe(0);
  });

  it("treats an unverified pending excusal as unknown, never as a day off", () => {
    const result = v2([v2Week("2026-09-13", ["pending", 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000])], [v2Policy()])[0];
    expect(result).toMatchObject({ outcome: "pending_data" });
    expect(result.days?.[0].assessment).toBe("unknown");
  });

  it("excused days pause sequences while an unknown gap breaks continuity", () => {
    const policy = v2Policy({ demotion: { unit: "weeks", length: 2 } });
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const paused = v2([missed("2026-09-13"), v2Week("2026-09-20", ["excused", "excused", "excused", "excused", "excused", "excused"]), missed("2026-09-27")], [policy]);
    expect(paused[2].sequence?.demotion).toMatchObject({ progress: 0, episode: { units: ["2026-09-13", "2026-09-27"] } });
    const gap = v2([missed("2026-09-13"), v2Week("2026-09-20", ["missing", "missing", "missing", "missing", "missing", "missing"]), missed("2026-09-27")], [policy]);
    expect(gap[1].sequence?.demotion.progress).toBeNull();
    expect(gap[2].sequence?.demotion.progress).toBe(1);
    expect(gap[2].sequence?.demotion.episode).toBeNull();
  });

  it("passes when the only required day is met and the other five are excused", () => {
    const result = v2([v2Week("2026-09-13", [8_000_000, "excused", "excused", "excused", "excused", "excused"])], [v2Policy()])[0];
    expect(result).toMatchObject({ outcome: "passed" });
    expect(result.counts).toMatchObject({ required: 1, met: 1, excused: 5 });
  });

  it("counts day sequences across week boundaries, year boundary and leap day", () => {
    const policy = v2Policy({ demotion: { unit: "days", length: 3 } });
    const weeks = [
      v2Week("2026-09-13", [8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 0]),
      v2Week("2026-09-20", [0, 0, 8_000_000, 8_000_000, 8_000_000, 8_000_000]),
    ];
    const result = v2(weeks, [policy])[1];
    expect(result.sequence?.demotion.episode).toEqual({ units: ["2026-09-12", "2026-09-14", "2026-09-15"] });
    expect(result.recommendation).toEqual({ kind: "demote", targetRank: 2 });
    const leap = v2([v2Week("2028-03-05", [8_000_000, 0, 0, 0, 0, 0]), v2Week("2028-03-12", [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000])], [v2Policy({ demotion: { unit: "days", length: 4 }, effectiveWeek: "2028-03-05" })], { ...member, joinedAt: "2020-01-01T02:00:00.000Z" }, { now: new Date("2028-03-20T12:00:00.000Z") });
    expect(leap[0].sequence?.demotion.episode?.units).toEqual(["2028-02-29", "2028-03-01", "2028-03-02", "2028-03-03"]);
    expect(leap[0].sequence?.demotion.progress).toBe(1);
    expect(leap[1].sequence?.demotion.episode?.units).toEqual(["2028-02-29", "2028-03-01", "2028-03-02", "2028-03-03"]);
    expect(leap[1].sequence?.demotion.progress).toBe(0);
  });

  it("counts week sequences only on closed eligible weeks", () => {
    const policy = v2Policy({ demotion: { unit: "weeks", length: 2 } });
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const results = v2([missed("2026-09-13"), missed("2026-09-20"), missed("2026-09-27")], [policy]);
    expect(results[1].recommendation).toEqual({ kind: "demote", targetRank: 2 });
    expect(results[1].sequence?.demotion.episode).toEqual({ units: ["2026-09-13", "2026-09-20"] });
    expect(results[2].sequence?.demotion.progress).toBe(1);
  });

  it("keeps a Mon–Wed episode reviewable after Thu–Sat recovery", () => {
    const policy = v2Policy({ demotion: { unit: "days", length: 3 } });
    const weekInput = v2Week("2026-09-13", [0, 0, 0, 8_000_000, 8_000_000, 8_000_000]);
    const result = v2([weekInput], [policy])[0];
    expect(result.outcome).toBe("missed");
    expect(result.sequence?.demotion).toMatchObject({ episode: { units: ["2026-09-07", "2026-09-08", "2026-09-09"] }, recoveredAfter: ["2026-09-10", "2026-09-11", "2026-09-12"] });
    expect(result.recommendation).toEqual({ kind: "demote", targetRank: 2 });
  });

  it.each([[1, 2], [2, 3]] as const)("signals promotion R%s→R%s after a qualifying positive run", (rank, targetRank) => {
    const results = v2([v2Week("2026-09-13", allMet), v2Week("2026-09-20", allMet)], [v2Policy()], { ...member, currentRank: rank });
    expect(results[1].signal).toEqual({ kind: "promotion", targetRank, reached: true });
    expect(results[1].recommendation.kind).toBe("none");
  });

  it("never signals promotion at rank 3 or above", () => {
    const results = v2([v2Week("2026-09-13", allMet), v2Week("2026-09-20", allMet)], [v2Policy()], { ...member, currentRank: 3 });
    expect(results[1].signal?.kind).toBe("none");
  });

  it("signals promotion on the provisional live week once closed units satisfy the run", () => {
    const live = "2026-11-22";
    const results = v2([v2Week("2026-11-08", allMet), v2Week("2026-11-15", allMet), v2Week(live, allMet)], [v2Policy({ promotion: { unit: "weeks", length: 2 } })], { ...member, currentRank: 1 }, { now: new Date("2026-11-20T12:00:00.000Z") });
    expect(results[2].provisional).toBe(true);
    expect(results[2].outcome).toBe("pending_data");
    expect(results[2].signal).toEqual({ kind: "promotion", targetRank: 2, reached: true });
    expect(results[2].recommendation.kind).toBe("none");
  });

  it("lets a known miss in the live week turn a would-be promotion into a concern", () => {
    const live = v2Week("2026-11-22", [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const results = v2([v2Week("2026-11-08", allMet), v2Week("2026-11-15", allMet), live], [v2Policy({ promotion: { unit: "weeks", length: 2 } })], { ...member, currentRank: 1 }, { now: new Date("2026-11-20T12:00:00.000Z") });
    expect(results[2].provisional).toBe(true);
    expect(results[2].signal?.kind).toBe("concern");
  });

  it("never signals promotion on the live week at rank 3", () => {
    const results = v2([v2Week("2026-11-08", allMet), v2Week("2026-11-15", allMet), v2Week("2026-11-22", allMet)], [v2Policy({ promotion: { unit: "weeks", length: 2 } })], { ...member, currentRank: 3 }, { now: new Date("2026-11-20T12:00:00.000Z") });
    expect(results[2].signal?.kind).toBe("none");
  });

  it("resets sequences at a policy model/version boundary", () => {
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const first = v2Policy({ demotion: { unit: "weeks", length: 2 }, effectiveWeek: "2026-09-13", version: 1 });
    const second = v2Policy({ demotion: { unit: "weeks", length: 2 }, effectiveWeek: "2026-09-20", version: 2 });
    const results = v2([missed("2026-09-13"), missed("2026-09-20"), missed("2026-09-27")], [first, second]);
    expect(results[1].sequence?.demotion.progress).toBe(1);
    expect(results[1].sequence?.demotion.episode).toBeNull();
    expect(results[2].sequence?.demotion.episode).toEqual({ units: ["2026-09-20", "2026-09-27"] });
  });

  it("restarts fresh proof after unknown evidence without bridging", () => {
    const policy = v2Policy({ demotion: { unit: "weeks", length: 2 } });
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const unknown = v2Week("2026-09-20", ["missing", "missing", "missing", "missing", "missing", "missing"]);
    const results = v2([missed("2026-09-13"), unknown, missed("2026-09-27"), missed("2026-10-04")], [policy]);
    expect(results[3].sequence?.demotion.episode).toEqual({ units: ["2026-09-27", "2026-10-04"] });
    expect(results[3].recommendation.kind).toBe("demote");
  });

  it("consumedThrough resets runs and prevents consumed evidence forming an episode", () => {
    const policy = v2Policy({ demotion: { unit: "weeks", length: 1 } });
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const results = v2([missed("2026-09-13"), missed("2026-09-20"), missed("2026-09-27")], [policy], member, { consumedThrough: "2026-09-20" });
    expect(results[1].recommendation.kind).toBe("none");
    expect(results[2].sequence?.demotion.episode).toEqual({ units: ["2026-09-27"] });
    expect(results[2].recommendation).toEqual({ kind: "demote", targetRank: 2 });
  });

  it("resets a settled week and clears its episode after the handled boundary", () => {
    const policy = v2Policy({ demotion: { unit: "weeks", length: 1 } });
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const first = v2([missed("2026-09-13")], [policy])[0];
    const settled = { actionId: "action-1", evaluationBasis: first.evaluationBasis, kind: "demote" as const, targetRank: 2 };
    const settledWeek = { ...missed("2026-09-13"), settled };
    const results = v2([settledWeek, missed("2026-09-20")], [policy]);
    expect(results[0].sequence?.demotion.episode).toBeNull();
    expect(results[0].recommendation.kind).toBe("none");
    expect(results[1].sequence?.demotion.episode).toEqual({ units: ["2026-09-20"] });
  });

  it("a waived week clears a pending episode unconditionally, resets the demotion run, and grants no promotion credit", () => {
    const policy = v2Policy({ demotion: { unit: "weeks", length: 1 } });
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const results = v2([missed("2026-09-13"), { ...missed("2026-09-20"), waived: true }, missed("2026-09-27")], [policy]);
    expect(results[1].outcome).toBe("waived");
    expect(results[1].sequence?.demotion.episode).toBeNull();
    expect(results[1].sequence?.demotion.recoveredAfter).toEqual([]);
    expect(results[1].recommendation).toEqual({ kind: "none", targetRank: null });
    expect(results[2].sequence?.demotion.episode).toEqual({ units: ["2026-09-27"] });
    expect(results[2].sequence?.promotion.progress).toBe(0);
  });

  it("drops a days-unit episode formed entirely before the waived week so it cannot re-fire later", () => {
    const policy = v2Policy({ demotion: { unit: "days", length: 3 } });
    const episodeWeek = v2Week("2026-09-13", [8_000_000, 0, 0, 0, 8_000_000, 8_000_000]);
    const metWeek = (ending: string) => v2Week(ending, allMet);
    const results = v2([episodeWeek, { ...metWeek("2026-09-20"), waived: true }, metWeek("2026-09-27")], [policy]);
    expect(results[0].sequence?.demotion.episode).toEqual({ units: ["2026-09-08", "2026-09-09", "2026-09-10"] });
    expect(results[0].recommendation).toEqual({ kind: "demote", targetRank: 2 });
    expect(results[1].outcome).toBe("waived");
    expect(results[1].sequence?.demotion.episode).toBeNull();
    expect(results[1].recommendation).toEqual({ kind: "none", targetRank: null });
    expect(results[2].sequence?.demotion.episode).toBeNull();
    expect(results[2].recommendation).toEqual({ kind: "none", targetRank: null });
    expect(results[2].sequence?.demotion.recoveredAfter).toEqual([]);
    const sameWeek = v2([{ ...v2Week("2026-09-13", [0, 0, 0, 8_000_000, 8_000_000, 8_000_000]), waived: true }, metWeek("2026-09-20")], [policy]);
    expect(sameWeek[0].outcome).toBe("waived");
    expect(sameWeek[0].sequence?.demotion.episode).toBeNull();
    expect(sameWeek[1].recommendation).toEqual({ kind: "none", targetRank: null });
  });

  it("provisional open weeks evaluate but never publish a recommendation", () => {
    const openNow = new Date("2026-09-10T12:00:00.000Z");
    const result = v2([v2Week("2026-09-13", [0, 0, 0, 8_000_000, 8_000_000, 8_000_000])], [v2Policy({ demotion: { unit: "days", length: 3 } })], member, { now: openNow })[0];
    expect(result).toMatchObject({ outcome: "pending_data", provisional: true, recommendation: { kind: "none" } });
    expect(result.days?.map((day) => day.assessment)).toEqual(["missed", "missed", "missed", "open", "open", "open"]);
    expect(result.signal).toMatchObject({ kind: "concern", reached: true });
  });

  it("honours the exact 02:00 UTC day-close boundary", () => {
    const weekInput = v2Week("2026-09-13", [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const closed = v2([weekInput], [v2Policy()], member, { now: new Date("2026-09-08T02:00:00.000Z") })[0];
    expect(closed.days?.[0].assessment).toBe("missed");
    expect(closed.days?.[1].assessment).toBe("open");
    const stillOpen = v2([weekInput], [v2Policy()], member, { now: new Date("2026-09-08T01:59:59.999Z") })[0];
    expect(stillOpen.days?.[0].assessment).toBe("open");
  });

  it("routes owner and unknown-rank episodes to leadership review like the legacy safeguards", () => {
    const policy = v2Policy({ demotion: { unit: "weeks", length: 1 } });
    const missed = (ending: string) => v2Week(ending, [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    expect(v2([missed("2026-09-13")], [policy], { ...member, isOwner: true })[0].recommendation.kind).toBe("leadership_review");
    expect(v2([missed("2026-09-13")], [policy], { ...member, currentRank: null })[0].recommendation.kind).toBe("leadership_review");
    expect(v2([missed("2026-09-13")], [policy], { ...member, currentRank: 1 })[0].recommendation.kind).toBe("remove");
  });

  it("reports a developing concern without promotion when only part of a demotion run exists", () => {
    const result = v2([v2Week("2026-09-13", [0, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000])], [v2Policy({ demotion: { unit: "weeks", length: 2 } })])[0];
    expect(result.recommendation.kind).toBe("none");
    expect(result.signal).toMatchObject({ kind: "concern", reached: false });
    expect(result.streak).toBe(1);
  });
});
