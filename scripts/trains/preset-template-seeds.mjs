/**
 * HQ week presets as seed rows for `train_rule_templates`.
 *
 * This mirrors `PRESET_WEEK_RULES` in
 * `src/lib/trains/rules/presets.shared.ts`. Seed scripts are plain `.mjs` and
 * cannot import the TypeScript module, so `presets.shared.test.ts` imports
 * both and asserts they are deeply equal — that test is the guard against
 * drift, not review discipline.
 *
 * Names are English fallbacks. The UI translates presets by `preset_key`
 * (`trains.templates.<key>`); the stored name is only used where no
 * translation exists.
 */

const VS_TOP_1 = { kind: "vs_top_n", topN: 1 };
const VS_TOP_10 = { kind: "vs_top_n", topN: 10 };
const R3_WHEEL = { kind: "rank_pool", pool: "r3", draw: "wheel" };
const R3_AWARD = { kind: "rank_pool", pool: "r3", draw: "manual" };
const R4_ROTATION = { kind: "rank_pool", pool: "r4_plus", draw: "wheel" };
const PIF_WEEKDAY = { kind: "price_is_freight", board: "weekday" };
const PIF_HEAVY_HITTER = { kind: "price_is_freight", board: "heavy_hitter" };
const DONATIONS_TOP = { kind: "donations_top" };
const EVENT_VIP = { kind: "event_top_x", eventKey: "capitol_war", topN: 10 };

const conductorPicksVip = (conductorRule) => ({ conductorRule, vipRule: null });
const R4_EVENT_VIP_DAY = { conductorRule: R4_ROTATION, vipRule: EVENT_VIP };
const NO_RULES = { conductorRule: null, vipRule: { kind: "none" } };

const everyDay = (rules) => ({
  sun: rules,
  mon: rules,
  tue: rules,
  wed: rules,
  thu: rules,
  fri: rules,
  sat: rules,
});

export const PRESET_TEMPLATE_SEEDS = [
  {
    key: "vs_push_week",
    name: "VS Push week",
    days: {
      mon: R4_EVENT_VIP_DAY,
      tue: conductorPicksVip(VS_TOP_1),
      wed: conductorPicksVip(VS_TOP_10),
      thu: conductorPicksVip(VS_TOP_10),
      fri: conductorPicksVip(VS_TOP_1),
      sat: conductorPicksVip(VS_TOP_10),
      sun: R4_EVENT_VIP_DAY,
    },
  },
  {
    key: "vs_push_week_lead_time",
    name: "VS push (lead time)",
    days: {
      mon: R4_EVENT_VIP_DAY,
      tue: R4_EVENT_VIP_DAY,
      wed: conductorPicksVip(VS_TOP_10),
      thu: conductorPicksVip(VS_TOP_10),
      fri: conductorPicksVip(VS_TOP_1),
      sat: conductorPicksVip(VS_TOP_10),
      sun: NO_RULES,
    },
  },
  {
    key: "economy_week",
    name: "Economy week",
    days: everyDay(conductorPicksVip(R3_WHEEL)),
  },
  {
    key: "price_is_right",
    name: "The Price Is Freight",
    days: {
      mon: NO_RULES,
      tue: conductorPicksVip(PIF_WEEKDAY),
      wed: conductorPicksVip(PIF_WEEKDAY),
      thu: conductorPicksVip(PIF_WEEKDAY),
      fri: conductorPicksVip(PIF_WEEKDAY),
      sat: conductorPicksVip(PIF_HEAVY_HITTER),
      sun: NO_RULES,
    },
  },
  {
    key: "r3_recognition",
    name: "R3 recognition",
    days: everyDay(conductorPicksVip(R3_AWARD)),
  },
  {
    key: "r4_train_week",
    name: "R4 Week",
    days: everyDay(conductorPicksVip(R4_ROTATION)),
  },
  {
    key: "donations_week",
    name: "Donations week",
    days: everyDay({
      conductorRule: DONATIONS_TOP,
      vipRule: { kind: "donations_second" },
    }),
  },
  {
    key: "custom",
    name: "Custom",
    days: everyDay(NO_RULES),
  },
];
