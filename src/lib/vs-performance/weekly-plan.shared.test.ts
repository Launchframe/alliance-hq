import { describe, expect, it } from "vitest";

import {
  buildVsPlatformDraft,
  conductorRuleForVsPlanDay,
  vsPlanDraftSchema,
  vsPlannedPushPoints,
  vsTrainDate,
  vsWeekStartSchema,
} from "./weekly-plan.shared";

const WEEK = "2026-09-21";

describe("buildVsPlatformDraft", () => {
  it("strategic_victory leaves all six days undecided", () => {
    const draft = buildVsPlatformDraft(WEEK, "strategic_victory");
    expect(draft.days).toHaveLength(6);
    expect(draft.days.every((d) => d.strategy === "undecided")).toBe(true);
    expect(draft.days.every((d) => !d.heavyHitterReward)).toBe(true);
  });

  it("price_is_freight maps Mon–Thu hard save, Fri unrestricted + heavy hitter, Sat unrestricted", () => {
    const draft = buildVsPlatformDraft(WEEK, "price_is_freight");
    expect(draft.days.map((d) => d.strategy)).toEqual([
      "hard_save",
      "hard_save",
      "hard_save",
      "hard_save",
      "unrestricted",
      "unrestricted",
    ]);
    expect(draft.days.map((d) => d.heavyHitterReward)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("uses default pushTopN [1,10,10,1,10,10]", () => {
    const draft = buildVsPlatformDraft(WEEK, "all_out_domination");
    expect(draft.days.map((d) => d.pushTopN)).toEqual([1, 10, 10, 1, 10, 10]);
  });

  it("rejects a non-Monday week start", () => {
    expect(() => buildVsPlatformDraft("2026-09-22", "strategic_victory")).toThrow();
    expect(vsWeekStartSchema.safeParse("2026-09-22").success).toBe(false);
    expect(vsWeekStartSchema.safeParse("not-a-date").success).toBe(false);
  });

  it("rejects a draft with duplicate/misaligned dates", () => {
    const draft = buildVsPlatformDraft(WEEK, "all_out_domination");
    const dup = {
      ...draft,
      days: draft.days.map((d, i) =>
        i === 1 ? { ...d, scoreDate: draft.days[0]!.scoreDate } : d,
      ),
    };
    expect(vsPlanDraftSchema.safeParse(dup).success).toBe(false);
  });
});

describe("conductorRuleForVsPlanDay", () => {
  const draft = buildVsPlatformDraft(WEEK, "strategic_victory");
  const day = (strategy: string, extra: Record<string, unknown> = {}) => ({
    ...draft.days[0]!,
    strategy: strategy as never,
    ...extra,
  });

  it("maps soft save to r3 wheel lottery", () => {
    expect(conductorRuleForVsPlanDay(day("soft_save"))).toEqual({
      kind: "rank_pool",
      pool: "r3",
      draw: "wheel",
    });
  });

  it("maps hard save to weekday Price Is Freight", () => {
    expect(conductorRuleForVsPlanDay(day("hard_save"))).toEqual({
      kind: "price_is_freight",
      board: "weekday",
    });
  });

  it("maps push to top-N with the day reward", () => {
    expect(
      conductorRuleForVsPlanDay(day("push", { pushTopN: 5 })),
    ).toEqual({ kind: "vs_top_n", topN: 5 });
  });

  it("undecided and plain unrestricted produce no rule", () => {
    expect(conductorRuleForVsPlanDay(day("undecided"))).toBeUndefined();
    expect(conductorRuleForVsPlanDay(day("unrestricted"))).toBeUndefined();
  });

  it("unrestricted with heavyHitterReward maps to the heavy-hitter board", () => {
    expect(
      conductorRuleForVsPlanDay(
        day("unrestricted", { heavyHitterReward: true }),
      ),
    ).toEqual({ kind: "price_is_freight", board: "heavy_hitter" });
  });
});

describe("vsPlannedPushPoints", () => {
  it("sums 1/2/2/2/2/4 only on push days", () => {
    expect(vsPlannedPushPoints(buildVsPlatformDraft(WEEK, "all_out_domination").days, WEEK)).toBe(13);
    expect(vsPlannedPushPoints(buildVsPlatformDraft(WEEK, "strategic_victory").days, WEEK)).toBe(0);
    expect(vsPlannedPushPoints(buildVsPlatformDraft(WEEK, "price_is_freight").days, WEEK)).toBe(0);
    expect(vsPlannedPushPoints(buildVsPlatformDraft(WEEK, "save_week").days, WEEK)).toBe(0);
  });

  it("counts Saturday push as 4 and ignores duplicate-free non-push days", () => {
    const draft = buildVsPlatformDraft(WEEK, "strategic_victory");
    const days = draft.days.map((day, index) => ({
      ...day,
      strategy: index === 0 || index === 5 ? "push" as const : day.strategy,
    }));
    expect(vsPlannedPushPoints(days, WEEK)).toBe(5);
  });

  it("throws on duplicate score dates or dates outside the week", () => {
    const draft = buildVsPlatformDraft(WEEK, "all_out_domination");
    const dup = [draft.days[0]!, draft.days[0]!];
    expect(() => vsPlannedPushPoints(dup, WEEK)).toThrow("invalid");
    expect(() =>
      vsPlannedPushPoints(
        [{ ...draft.days[0]!, scoreDate: "2026-09-27" }],
        WEEK,
      ),
    ).toThrow("invalid");
  });
});

describe("vsTrainDate", () => {
  it("lead 0 maps Monday score date to Tuesday train date", () => {
    expect(vsTrainDate(WEEK, 0)).toBe("2026-09-22");
  });

  it("lead 7 maps Monday score date a full week ahead", () => {
    expect(vsTrainDate(WEEK, 7)).toBe("2026-09-29");
  });
});
