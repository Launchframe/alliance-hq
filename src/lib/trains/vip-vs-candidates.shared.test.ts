import { describe, expect, it } from "vitest";

import {
  parseVipRule,
  vipRuleIdentity,
  vsMillionsToPoints,
} from "@/lib/trains/rules/catalog.shared";
import {
  canSpinVipForRule,
  spinSourceForVipRule,
  vipRuleSourceDay,
} from "@/lib/trains/rules/derive.shared";

import { selectVipVsCandidates } from "./vip-vs-candidates.shared";

const board = [
  { memberId: "conductor", memberName: "Conductor", priorDayVsScore: 12_000_000 },
  { memberId: "a", memberName: "A", priorDayVsScore: 9_000_000 },
  { memberId: "b", memberName: "B", priorDayVsScore: 7_500_000 },
  { memberId: "c", memberName: "C", priorDayVsScore: 7_400_000 },
  { memberId: "d", memberName: "D", priorDayVsScore: 3_000_000 },
];

describe("selectVipVsCandidates", () => {
  it("leaves the conductor out so Top 1 is the best non-conductor", () => {
    const { available } = selectVipVsCandidates({
      board,
      rule: { kind: "vs_top_n", topN: 1 },
      conductorMemberId: "conductor",
    });
    expect(available.map((c) => c.memberId)).toEqual(["a"]);
  });

  it("fills Top N from non-conductors", () => {
    const { available } = selectVipVsCandidates({
      board,
      rule: { kind: "vs_top_n", topN: 3 },
      conductorMemberId: "conductor",
    });
    expect(available.map((c) => c.memberId)).toEqual(["a", "b", "c"]);
  });

  it("keeps only scores strictly above the threshold", () => {
    const { available } = selectVipVsCandidates({
      board,
      rule: { kind: "vs_min_score", minScore: 7_400_000 },
      conductorMemberId: "conductor",
    });
    expect(available.map((c) => c.memberId)).toEqual(["a", "b"]);
  });

  it("drops members on time off after scoping", () => {
    const { scoped, available } = selectVipVsCandidates({
      board,
      rule: { kind: "vs_top_n", topN: 1 },
      conductorMemberId: "conductor",
      awayMemberIds: new Set(["a"]),
    });
    expect(scoped.map((c) => c.memberId)).toEqual(["a"]);
    expect(available).toEqual([]);
  });
});

describe("VIP VS rules", () => {
  it("parses millions with decimals or a comma", () => {
    expect(vsMillionsToPoints("7.5")).toBe(7_500_000);
    expect(vsMillionsToPoints("7,25")).toBe(7_250_000);
    expect(vsMillionsToPoints("12")).toBe(12_000_000);
    expect(vsMillionsToPoints("0")).toBeNull();
    expect(vsMillionsToPoints("-1")).toBeNull();
    expect(vsMillionsToPoints("abc")).toBeNull();
    expect(vsMillionsToPoints("")).toBeNull();
  });

  it("round-trips through the VIP schema with distinct identities", () => {
    expect(parseVipRule({ kind: "vs_top_n", topN: 3 })).toEqual({
      kind: "vs_top_n",
      topN: 3,
    });
    expect(parseVipRule({ kind: "vs_top_n", topN: 7 })).toBeNull();
    expect(parseVipRule({ kind: "vs_min_score", minScore: 7_500_000 })).toEqual({
      kind: "vs_min_score",
      minScore: 7_500_000,
    });
    expect(parseVipRule({ kind: "vs_min_score", minScore: 0 })).toBeNull();
    expect(vipRuleIdentity({ kind: "vs_min_score", minScore: 7_500_000 })).not.toBe(
      vipRuleIdentity({ kind: "vs_min_score", minScore: 8_000_000 }),
    );
  });

  it("spins from the prior VS day once the conductor is locked", () => {
    const rule = { kind: "vs_min_score", minScore: 5_000_000 } as const;
    expect(canSpinVipForRule(rule, false)).toBe(false);
    expect(canSpinVipForRule(rule, true)).toBe(true);
    expect(spinSourceForVipRule(rule)).toEqual({
      kind: "vs_min_score",
      minScore: 5_000_000,
    });
    expect(spinSourceForVipRule({ kind: "vs_top_n", topN: 5 })).toEqual({
      kind: "vs_leaderboard",
      topN: 5,
    });
    expect(vipRuleSourceDay(rule, "2026-10-11").kind).toBe("score_day");
  });
});
