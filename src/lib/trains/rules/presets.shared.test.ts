import { describe, expect, it } from "vitest";

import { validateConductorRuleOnWeekday } from "@/lib/trains/rules/derive.shared";
import {
  PRESET_KEYS,
  PRESET_WEEK_RULES,
  type PresetKey,
  WEEKDAY_KEYS,
  presetRulesForDate,
  weekRulesForPreset,
  weekdayKeyForDate,
} from "@/lib/trains/rules/presets.shared";
import { WEEK_TEMPLATES } from "@/lib/trains/types";

describe("preset shapes", () => {
  it("stays in lockstep with WEEK_TEMPLATES", () => {
    expect([...PRESET_KEYS].sort()).toEqual([...WEEK_TEMPLATES].sort());
  });

  it("gives every preset all seven calendar weekdays", () => {
    for (const preset of PRESET_KEYS) {
      const week = PRESET_WEEK_RULES[preset];
      for (const day of WEEKDAY_KEYS) {
        expect(week[day], `${preset}.${day}`).toBeDefined();
      }
    }
  });

  it("falls back to free-choice rules for an unknown preset", () => {
    expect(weekRulesForPreset("not_a_preset")).toEqual(
      PRESET_WEEK_RULES.custom,
    );
  });
});

describe("vs_push_week", () => {
  // The composite used to expand by an index relative to Tuesday. Slots are
  // now calendar weekdays, so the same rules land on the same real days for
  // every alliance regardless of trainWeekStartDow.
  it("runs the VS boards Tue-Sat", () => {
    const week = PRESET_WEEK_RULES.vs_push_week;
    expect(week.tue.conductorRule).toEqual({ kind: "vs_top_n", topN: 1 });
    expect(week.wed.conductorRule).toEqual({ kind: "vs_top_n", topN: 10 });
    expect(week.thu.conductorRule).toEqual({ kind: "vs_top_n", topN: 10 });
    expect(week.fri.conductorRule).toEqual({ kind: "vs_top_n", topN: 1 });
    expect(week.sat.conductorRule).toEqual({ kind: "vs_top_n", topN: 10 });
  });

  it("runs R4 rotation with an event VIP Sun-Mon", () => {
    const week = PRESET_WEEK_RULES.vs_push_week;
    for (const day of ["sun", "mon"] as const) {
      expect(week[day].conductorRule).toEqual({
        kind: "rank_pool",
        pool: "r4_plus",
        draw: "wheel",
      });
      expect(week[day].vipRule).toEqual({
        kind: "event_top_x",
        eventKey: "capitol_war",
        topN: 10,
      });
    }
  });

  it("never places a VS rule on a day that would read Sunday at lead 0", () => {
    const week = PRESET_WEEK_RULES.vs_push_week;
    WEEKDAY_KEYS.forEach((day, dow) => {
      expect(
        validateConductorRuleOnWeekday(week[day].conductorRule, dow, 0).ok,
        `${day} at lead 0`,
      ).toBe(true);
    });
  });

  it("leaves the conductor free to pick the VIP on VS days", () => {
    expect(PRESET_WEEK_RULES.vs_push_week.wed.vipRule).toBeNull();
  });
});

describe("vs_push_week_lead_time", () => {
  it("is valid at lead time 1, where Tuesday would read Sunday", () => {
    const week = PRESET_WEEK_RULES.vs_push_week_lead_time;
    WEEKDAY_KEYS.forEach((day, dow) => {
      expect(
        validateConductorRuleOnWeekday(week[day].conductorRule, dow, 1).ok,
        `${day} at lead 1`,
      ).toBe(true);
    });
  });

  it("exists because vs_push_week is not valid at lead time 1", () => {
    // Tuesday reads Sunday once lead time shifts the source day, so the
    // companion preset swaps that day to R4 rotation instead.
    expect(
      validateConductorRuleOnWeekday(
        PRESET_WEEK_RULES.vs_push_week.tue.conductorRule,
        2,
        1,
      ).ok,
    ).toBe(false);
    expect(PRESET_WEEK_RULES.vs_push_week_lead_time.tue.conductorRule).toEqual({
      kind: "rank_pool",
      pool: "r4_plus",
      draw: "wheel",
    });
  });
});

describe("price_is_right", () => {
  it("raffles Tue-Fri and draws the max-ticket list on Saturday", () => {
    const week = PRESET_WEEK_RULES.price_is_right;
    for (const day of ["tue", "wed", "thu", "fri"] as const) {
      expect(week[day].conductorRule).toEqual({
        kind: "price_is_freight",
        board: "weekday",
      });
    }
    expect(week.sat.conductorRule).toEqual({
      kind: "price_is_freight",
      board: "heavy_hitter",
    });
  });

  it("leaves Sun-Mon free with no VIP", () => {
    const week = PRESET_WEEK_RULES.price_is_right;
    for (const day of ["sun", "mon"] as const) {
      expect(week[day].conductorRule).toBeNull();
      expect(week[day].vipRule).toEqual({ kind: "none" });
    }
  });
});

describe("weekday resolution", () => {
  it("maps a date to its calendar weekday slot", () => {
    // 2026-08-10 Mon … 2026-08-16 Sun
    expect(weekdayKeyForDate("2026-08-10")).toBe("mon");
    expect(weekdayKeyForDate("2026-08-15")).toBe("sat");
    expect(weekdayKeyForDate("2026-08-16")).toBe("sun");
  });

  it("resolves preset rules for a date independently of week start", () => {
    expect(presetRulesForDate("price_is_right", "2026-08-15")).toEqual(
      PRESET_WEEK_RULES.price_is_right.sat,
    );
  });
});

describe("single-rule presets", () => {
  it("applies one rule to every day", () => {
    for (const preset of [
      "economy_week",
      "r3_recognition",
      "r4_train_week",
      "donations_week",
      "custom",
    ] as const) {
      const week = PRESET_WEEK_RULES[preset];
      const first = week.mon;
      for (const day of WEEKDAY_KEYS) {
        expect(week[day], `${preset}.${day}`).toEqual(first);
      }
    }
  });
});

describe("preset seed parity", () => {
  it("matches the deploy seed shapes exactly", async () => {
    // The seed script is plain `.mjs` and cannot import this module, so this
    // is the only thing keeping the two in step. If it fails, fix the seed —
    // `PRESET_WEEK_RULES` is the source of truth.
    const { PRESET_TEMPLATE_SEEDS } = (await import(
      "../../../../scripts/trains/preset-template-seeds.mjs"
    )) as { PRESET_TEMPLATE_SEEDS: Array<{ key: string; days: unknown }> };

    expect(PRESET_TEMPLATE_SEEDS.map((seed) => seed.key).sort()).toEqual(
      [...PRESET_KEYS].sort(),
    );
    for (const seed of PRESET_TEMPLATE_SEEDS) {
      expect(seed.days, `preset ${seed.key}`).toEqual(
        PRESET_WEEK_RULES[seed.key as PresetKey],
      );
    }
  });

  it("keeps every preset key selectable as a week template", () => {
    expect([...PRESET_KEYS].sort()).toEqual([...WEEK_TEMPLATES].sort());
  });
});
