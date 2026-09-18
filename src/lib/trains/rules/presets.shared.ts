import { getServerDayOfWeek } from "@/lib/trains/game-time";
import type {
  ConductorRule,
  DayRules,
  VipRule,
} from "@/lib/trains/rules/catalog.shared";

/**
 * Week presets HQ ships, expressed as seven **calendar weekday** slots.
 *
 * Slots are keyed Mon–Sun because the VS match week (Mon–Sat, Sunday off) is a
 * game fact, identical for every alliance. `trainWeekStartDow` only decides
 * where an alliance's calendar starts rendering; it never changes which rule
 * applies to a date. Lead time shifts the day a rule *reads from*, which is
 * why `vs_push_week_lead_time` needs different rules rather than a shifted
 * copy — see `validateConductorRuleOnWeekday`.
 *
 * These are the **seed source of truth**: `scripts/trains/seed-rule-templates.mjs`
 * upserts them into `train_rule_templates` on every deploy, and
 * `presets.shared.test.ts` asserts the seeded shapes still match.
 */

export const WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

/** Index matches `getServerDayOfWeek` (0=Sun … 6=Sat). */
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type TemplateWeekRules = Record<WeekdayKey, DayRules>;

export function weekdayKeyForDow(dow: number): WeekdayKey {
  return WEEKDAY_KEYS[((dow % 7) + 7) % 7];
}

export function weekdayKeyForDate(date: string): WeekdayKey {
  return weekdayKeyForDow(getServerDayOfWeek(date));
}

const DEFAULT_EVENT_VIP: VipRule = {
  kind: "event_top_x",
  eventKey: "capitol_war",
  topN: 10,
};

const VS_TOP_1: ConductorRule = { kind: "vs_top_n", topN: 1 };
const VS_TOP_10: ConductorRule = { kind: "vs_top_n", topN: 10 };
const R3_WHEEL: ConductorRule = { kind: "rank_pool", pool: "r3", draw: "wheel" };
const R3_AWARD: ConductorRule = {
  kind: "rank_pool",
  pool: "r3",
  draw: "manual",
};
const R4_ROTATION: ConductorRule = {
  kind: "rank_pool",
  pool: "r4_plus",
  draw: "wheel",
};
const PIF_WEEKDAY: ConductorRule = {
  kind: "price_is_freight",
  board: "weekday",
};
const PIF_HEAVY_HITTER: ConductorRule = {
  kind: "price_is_freight",
  board: "heavy_hitter",
};
const DONATIONS_TOP: ConductorRule = { kind: "donations_top" };

/** Conductor rule with the conductor free-picking the VIP. */
function conductorPicksVip(conductorRule: ConductorRule | null): DayRules {
  return { conductorRule, vipRule: null };
}

const R4_EVENT_VIP_DAY: DayRules = {
  conductorRule: R4_ROTATION,
  vipRule: DEFAULT_EVENT_VIP,
};

const NO_RULES: DayRules = { conductorRule: null, vipRule: { kind: "none" } };

function everyDay(rules: DayRules): TemplateWeekRules {
  return {
    sun: rules,
    mon: rules,
    tue: rules,
    wed: rules,
    thu: rules,
    fri: rules,
    sat: rules,
  };
}

export const PRESET_WEEK_RULES = {
  /** Tue–Sat VS push, Sun–Mon R4 rotation with an event-lottery VIP. */
  vs_push_week: {
    mon: R4_EVENT_VIP_DAY,
    tue: conductorPicksVip(VS_TOP_1),
    wed: conductorPicksVip(VS_TOP_10),
    thu: conductorPicksVip(VS_TOP_10),
    fri: conductorPicksVip(VS_TOP_1),
    sat: conductorPicksVip(VS_TOP_10),
    sun: R4_EVENT_VIP_DAY,
  },
  /**
   * Companion to lead time ≥ 1. Tuesday reads Sunday once lead time shifts the
   * source day, so it runs R4 rotation instead of a VS board.
   */
  vs_push_week_lead_time: {
    mon: R4_EVENT_VIP_DAY,
    tue: R4_EVENT_VIP_DAY,
    wed: conductorPicksVip(VS_TOP_10),
    thu: conductorPicksVip(VS_TOP_10),
    fri: conductorPicksVip(VS_TOP_1),
    sat: conductorPicksVip(VS_TOP_10),
    sun: NO_RULES,
  },
  /** R3 wheel every day — the economy pivot. */
  economy_week: everyDay(conductorPicksVip(R3_WHEEL)),
  /** Tue–Fri eligible-VS raffle, Sat max-ticket draw, Sun–Mon free choice. */
  price_is_right: {
    mon: NO_RULES,
    tue: conductorPicksVip(PIF_WEEKDAY),
    wed: conductorPicksVip(PIF_WEEKDAY),
    thu: conductorPicksVip(PIF_WEEKDAY),
    fri: conductorPicksVip(PIF_WEEKDAY),
    sat: conductorPicksVip(PIF_HEAVY_HITTER),
    sun: NO_RULES,
  },
  /** Manual R3 award pick every day — depleting, no wheel. */
  r3_recognition: everyDay(conductorPicksVip(R3_AWARD)),
  /** R4+ officer rotation every day. */
  r4_train_week: everyDay(conductorPicksVip(R4_ROTATION)),
  donations_week: everyDay({
    conductorRule: DONATIONS_TOP,
    vipRule: { kind: "donations_second" },
  }),
  /** No preset rules — officers paint each day or pick manually. */
  custom: everyDay(NO_RULES),
} as const satisfies Record<string, TemplateWeekRules>;

export type PresetKey = keyof typeof PRESET_WEEK_RULES;

export const PRESET_KEYS = Object.keys(PRESET_WEEK_RULES) as PresetKey[];

export function isPresetKey(value: string): value is PresetKey {
  return value in PRESET_WEEK_RULES;
}

export const DEFAULT_PRESET_KEY: PresetKey = "vs_push_week";

export function weekRulesForPreset(preset: string): TemplateWeekRules {
  return isPresetKey(preset)
    ? PRESET_WEEK_RULES[preset]
    : PRESET_WEEK_RULES.custom;
}

/** Rules a preset assigns to a calendar date. */
export function presetRulesForDate(preset: string, date: string): DayRules {
  return weekRulesForPreset(preset)[weekdayKeyForDate(date)];
}
