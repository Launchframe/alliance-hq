import type { WeekTemplateType } from "@/lib/trains/types";

export const MECHANISM_STYLES: Record<string, string> = {
  vs_high_score:
    "border-blue-500 bg-blue-500/15 text-blue-200 light:bg-blue-100 light:text-blue-700",
  vs_top_10:
    "border-blue-500 bg-blue-500/15 text-blue-200 light:bg-blue-100 light:text-blue-700",
  vs_top_n:
    "border-blue-500 bg-blue-500/15 text-blue-200 light:bg-blue-100 light:text-blue-700",
  vr_top_n:
    "border-violet-500 bg-violet-500/15 text-violet-200 light:bg-violet-100 light:text-violet-800",
  r3_lottery:
    "border-emerald-500 bg-emerald-500/15 text-emerald-200 light:bg-emerald-100 light:text-emerald-800",
  heavy_hitter_lottery:
    "border-cyan-500 bg-cyan-500/15 text-cyan-200 light:bg-cyan-100 light:text-cyan-800",
  r4_sequence:
    "border-purple-500 bg-purple-500/15 text-purple-200 light:bg-purple-100 light:text-purple-800",
  donations_top:
    "border-amber-500 bg-amber-500/15 text-amber-200 light:bg-amber-100 light:text-amber-800",
  officer_pick:
    "border-slate-400 bg-slate-500/15 text-slate-200 light:bg-slate-100 light:text-slate-700",
  event_top_x_lottery:
    "border-pink-500 bg-pink-500/15 text-pink-200 light:bg-pink-100 light:text-pink-800",
  custom:
    "border-slate-500 bg-slate-500/15 text-slate-200 light:bg-slate-100 light:text-slate-700",
};

export const TEMPLATE_PALETTE_STYLES: Record<
  WeekTemplateType,
  { swatch: string; ring: string }
> = {
  vs_push_week: {
    swatch: "bg-blue-500",
    ring: "ring-blue-500",
  },
  vs_push_weekdays: {
    swatch: "bg-blue-500",
    ring: "ring-blue-500",
  },
  r4_event_vip: {
    swatch: "bg-slate-400",
    ring: "ring-slate-400",
  },
  top_vs: {
    swatch: "bg-blue-500",
    ring: "ring-blue-500",
  },
  top_vr: {
    swatch: "bg-violet-500",
    ring: "ring-violet-500",
  },
  economy_week: {
    swatch: "bg-red-500",
    ring: "ring-red-500",
  },
  price_is_right: {
    swatch: "bg-cyan-500",
    ring: "ring-cyan-500",
  },
  price_is_right_weekdays: {
    swatch: "bg-cyan-500",
    ring: "ring-cyan-500",
  },
  takedown_week: {
    swatch: "bg-cyan-400",
    ring: "ring-cyan-400",
  },
  r3_recognition: {
    swatch: "bg-emerald-400",
    ring: "ring-emerald-400",
  },
  r4_train_week: {
    swatch: "bg-purple-500",
    ring: "ring-purple-500",
  },
  donations_week: {
    swatch: "bg-amber-500",
    ring: "ring-amber-500",
  },
  custom: {
    swatch: "bg-slate-500",
    ring: "ring-slate-500",
  },
};

export function mechanismStyleClass(mechanism: string): string {
  return MECHANISM_STYLES[mechanism] ?? MECHANISM_STYLES.custom;
}
