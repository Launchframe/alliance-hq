import {
  VR_TOP_N_SCOPES,
  VS_TOP_N_SCOPES,
  type ConductorRule,
} from "@/lib/trains/rules/catalog.shared";

/**
 * The day-rule palette officers paint from.
 *
 * Every paint surface (guided picker, long-press menu, month toolbar,
 * hotkeys, week editor) renders this one list, so a rule can no longer be
 * half-specified by whichever control the officer happened to use. Scoped
 * entries carry their scope list; painting one without a scope is not
 * representable.
 *
 * Replaces `DAY_PAINT_TEMPLATES`, which mixed genuine day rules with
 * whole-week composites like `vs_push_weekdays` (a day-of-week table that
 * silently applied seven different rules when painted onto one day).
 */

export const DAY_RULE_PALETTE_IDS = [
  "free_choice",
  "vs_top_n",
  "vr_top_n",
  "r3_lottery",
  "r3_award",
  "pif_weekday",
  "pif_heavy_hitter",
  "r4_rotation",
  "heavy_hitter_pool",
  "donations_top",
  "event_top_x",
] as const;

export type DayRulePaletteId = (typeof DAY_RULE_PALETTE_IDS)[number];

export type DayRulePaletteEntry = {
  id: DayRulePaletteId;
  /** Fixed rule, or null when the officer must choose a scope first. */
  rule: ConductorRule | null;
  /** Present when the entry needs a scope before it can be painted. */
  scopes?: readonly number[];
  /** True for the "no rule" entry, which is a real choice, not an absence. */
  isFreeChoice?: boolean;
};

export const DAY_RULE_PALETTE: readonly DayRulePaletteEntry[] = [
  { id: "free_choice", rule: null, isFreeChoice: true },
  { id: "vs_top_n", rule: null, scopes: VS_TOP_N_SCOPES },
  { id: "vr_top_n", rule: null, scopes: VR_TOP_N_SCOPES },
  { id: "r3_lottery", rule: { kind: "rank_pool", pool: "r3", draw: "wheel" } },
  { id: "r3_award", rule: { kind: "rank_pool", pool: "r3", draw: "manual" } },
  { id: "pif_weekday", rule: { kind: "price_is_freight", board: "weekday" } },
  {
    id: "pif_heavy_hitter",
    rule: { kind: "price_is_freight", board: "heavy_hitter" },
  },
  {
    id: "r4_rotation",
    rule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
  },
  {
    id: "heavy_hitter_pool",
    rule: { kind: "rank_pool", pool: "heavy_hitter", draw: "wheel" },
  },
  { id: "donations_top", rule: { kind: "donations_top" } },
  {
    id: "event_top_x",
    rule: { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
  },
];

export function paletteEntry(
  id: DayRulePaletteId,
): DayRulePaletteEntry | undefined {
  return DAY_RULE_PALETTE.find((entry) => entry.id === id);
}

export function paletteEntryRequiresScope(id: DayRulePaletteId): boolean {
  return (paletteEntry(id)?.scopes?.length ?? 0) > 0;
}

/**
 * Scope to use when a surface paints a scoped board without an explicit pick
 * (hotkeys). Callers should prefer the scope already on the day.
 */
export function defaultScopeForPaletteId(
  id: DayRulePaletteId,
): number | null {
  if (id === "vs_top_n") return 10;
  if (id === "vr_top_n") return 3;
  return null;
}

/** Build the rule for a palette selection. Scoped entries require `topN`. */
export function ruleForPaletteSelection(
  id: DayRulePaletteId,
  topN?: number | null,
): ConductorRule | null {
  if (id === "vs_top_n") {
    const scope = VS_TOP_N_SCOPES.find((value) => value === topN);
    return scope ? { kind: "vs_top_n", topN: scope } : null;
  }
  if (id === "vr_top_n") {
    const scope = VR_TOP_N_SCOPES.find((value) => value === topN);
    return scope ? { kind: "vr_top_n", topN: scope } : null;
  }
  return paletteEntry(id)?.rule ?? null;
}

/** Which palette row is highlighted for a day's current rule. */
export function paletteIdForRule(
  rule: ConductorRule | null,
): DayRulePaletteId {
  if (!rule) return "free_choice";
  switch (rule.kind) {
    case "vs_top_n":
      return "vs_top_n";
    case "vr_top_n":
      return "vr_top_n";
    case "rank_pool":
      if (rule.pool === "r3") {
        return rule.draw === "manual" ? "r3_award" : "r3_lottery";
      }
      return rule.pool === "r4_plus" ? "r4_rotation" : "heavy_hitter_pool";
    case "price_is_freight":
      return rule.board === "heavy_hitter"
        ? "pif_heavy_hitter"
        : "pif_weekday";
    case "donations_top":
      return "donations_top";
    case "event_top_x":
      return "event_top_x";
  }
}

/** Scope currently applied, for pre-selecting the scope list. */
export function scopeForRule(rule: ConductorRule | null): number | null {
  if (rule?.kind === "vs_top_n" || rule?.kind === "vr_top_n") {
    return rule.topN;
  }
  return null;
}

/** Dual-mode cell styling, keyed by palette id. */
export const RULE_CELL_STYLES: Record<DayRulePaletteId, string> = {
  free_choice:
    "border-slate-500 bg-slate-500/15 text-slate-200 light:bg-slate-100 light:text-slate-700",
  vs_top_n:
    "border-blue-500 bg-blue-500/15 text-blue-200 light:bg-blue-100 light:text-blue-700",
  vr_top_n:
    "border-violet-500 bg-violet-500/15 text-violet-200 light:bg-violet-100 light:text-violet-800",
  r3_lottery:
    "border-red-500 bg-red-500/15 text-red-200 light:bg-red-100 light:text-red-800",
  r3_award:
    "border-emerald-500 bg-emerald-500/15 text-emerald-200 light:bg-emerald-100 light:text-emerald-800",
  pif_weekday:
    "border-cyan-500 bg-cyan-500/15 text-cyan-200 light:bg-cyan-100 light:text-cyan-800",
  pif_heavy_hitter:
    "border-cyan-400 bg-cyan-400/15 text-cyan-100 light:bg-cyan-100 light:text-cyan-800",
  r4_rotation:
    "border-purple-500 bg-purple-500/15 text-purple-200 light:bg-purple-100 light:text-purple-800",
  heavy_hitter_pool:
    "border-teal-500 bg-teal-500/15 text-teal-200 light:bg-teal-100 light:text-teal-800",
  donations_top:
    "border-amber-500 bg-amber-500/15 text-amber-200 light:bg-amber-100 light:text-amber-800",
  event_top_x:
    "border-pink-500 bg-pink-500/15 text-pink-200 light:bg-pink-100 light:text-pink-800",
};

export const RULE_PALETTE_SWATCHES: Record<
  DayRulePaletteId,
  { swatch: string; ring: string }
> = {
  free_choice: { swatch: "bg-slate-500", ring: "ring-slate-500" },
  vs_top_n: { swatch: "bg-blue-500", ring: "ring-blue-500" },
  vr_top_n: { swatch: "bg-violet-500", ring: "ring-violet-500" },
  r3_lottery: { swatch: "bg-red-500", ring: "ring-red-500" },
  r3_award: { swatch: "bg-emerald-400", ring: "ring-emerald-400" },
  pif_weekday: { swatch: "bg-cyan-500", ring: "ring-cyan-500" },
  pif_heavy_hitter: { swatch: "bg-cyan-400", ring: "ring-cyan-400" },
  r4_rotation: { swatch: "bg-purple-500", ring: "ring-purple-500" },
  heavy_hitter_pool: { swatch: "bg-teal-500", ring: "ring-teal-500" },
  donations_top: { swatch: "bg-amber-500", ring: "ring-amber-500" },
  event_top_x: { swatch: "bg-pink-500", ring: "ring-pink-500" },
};

export function ruleCellStyleClass(rule: ConductorRule | null): string {
  return RULE_CELL_STYLES[paletteIdForRule(rule)];
}
