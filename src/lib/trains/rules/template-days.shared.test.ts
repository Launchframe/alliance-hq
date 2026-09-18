import { describe, expect, it } from "vitest";

import { PRESET_WEEK_RULES } from "@/lib/trains/rules/presets.shared";
import {
  parseTemplateWeekRules,
  templateRulesForDate,
  validateTemplateWeekRules,
} from "@/lib/trains/rules/template-days.shared";

describe("parseTemplateWeekRules", () => {
  it("round-trips a valid seven-slot payload", () => {
    expect(parseTemplateWeekRules(PRESET_WEEK_RULES.price_is_right)).toEqual(
      PRESET_WEEK_RULES.price_is_right,
    );
  });

  it("fills missing slots with free choice rather than throwing", () => {
    // A template row written by an older release must still render.
    const parsed = parseTemplateWeekRules({
      mon: { conductorRule: { kind: "vs_top_n", topN: 5 }, vipRule: null },
    });
    expect(parsed.mon.conductorRule).toEqual({ kind: "vs_top_n", topN: 5 });
    expect(parsed.tue).toEqual({ conductorRule: null, vipRule: null });
    expect(Object.keys(parsed)).toHaveLength(7);
  });

  it("drops a slot whose rule no longer parses", () => {
    const parsed = parseTemplateWeekRules({
      ...PRESET_WEEK_RULES.economy_week,
      wed: { conductorRule: { kind: "vs_push_weekdays" }, vipRule: null },
    });
    expect(parsed.wed.conductorRule).toBeNull();
    expect(parsed.thu.conductorRule).toEqual({
      kind: "rank_pool",
      pool: "r3",
      draw: "wheel",
    });
  });

  it("treats a non-object payload as a free week", () => {
    for (const value of [null, undefined, 42, "custom"]) {
      const parsed = parseTemplateWeekRules(value);
      expect(parsed.mon).toEqual({ conductorRule: null, vipRule: null });
    }
  });
});

describe("templateRulesForDate", () => {
  it("keys slots to the calendar weekday", () => {
    // 2026-06-13 is a Saturday, 2026-06-10 a Wednesday.
    expect(
      templateRulesForDate(PRESET_WEEK_RULES.price_is_right, "2026-06-13")
        .conductorRule,
    ).toEqual({ kind: "price_is_freight", board: "heavy_hitter" });
    expect(
      templateRulesForDate(PRESET_WEEK_RULES.price_is_right, "2026-06-10")
        .conductorRule,
    ).toEqual({ kind: "price_is_freight", board: "weekday" });
  });

  it("is independent of any alliance's display week start", () => {
    // Same date, same rule — the preference is render-only.
    const saturday = templateRulesForDate(
      PRESET_WEEK_RULES.vs_push_week,
      "2026-06-13",
    );
    expect(saturday.conductorRule).toEqual({ kind: "vs_top_n", topN: 10 });
  });
});

describe("validateTemplateWeekRules", () => {
  it("warns on Monday at lead 0, because Monday reads Sunday", () => {
    const warnings = validateTemplateWeekRules(
      PRESET_WEEK_RULES.vs_push_week,
      0,
    );
    expect(warnings.map((warning) => warning.weekday)).toEqual([]);
  });

  it("warns when a VS board reads the Sunday break", () => {
    const days = {
      ...PRESET_WEEK_RULES.vs_push_week,
      mon: { conductorRule: { kind: "vs_top_n", topN: 10 }, vipRule: null },
    } as const;
    const warnings = validateTemplateWeekRules(days, 0);
    expect(warnings).toEqual([
      { weekday: "mon", reason: "source_day_not_vs_day", sourceDow: 0 },
    ]);
  });

  it("moves the broken slot to Tuesday at lead 1", () => {
    // vs_push_week runs Top VS 1 on Tuesday, which reads Sunday at lead 1.
    const warnings = validateTemplateWeekRules(
      PRESET_WEEK_RULES.vs_push_week,
      1,
    );
    expect(warnings.map((warning) => warning.weekday)).toEqual(["tue"]);
  });

  it("has no warnings for the lead-time companion preset", () => {
    expect(
      validateTemplateWeekRules(PRESET_WEEK_RULES.vs_push_week_lead_time, 1),
    ).toEqual([]);
  });

  it("never warns about pool rules, which read no scores", () => {
    expect(validateTemplateWeekRules(PRESET_WEEK_RULES.r4_train_week, 1)).toEqual(
      [],
    );
    expect(validateTemplateWeekRules(PRESET_WEEK_RULES.custom, 1)).toEqual([]);
  });
});
