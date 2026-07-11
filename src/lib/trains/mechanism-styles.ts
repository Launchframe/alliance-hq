import type { WeekTemplateType } from "@/lib/trains/types";

export const MECHANISM_STYLES: Record<string, string> = {
  vs_high_score: "border-blue-500 bg-blue-500/15 text-blue-200",
  vs_top_10: "border-blue-500 bg-blue-500/15 text-blue-200",
  r3_lottery: "border-emerald-500 bg-emerald-500/15 text-emerald-200",
  heavy_hitter_lottery: "border-cyan-500 bg-cyan-500/15 text-cyan-200",
  r4_sequence: "border-purple-500 bg-purple-500/15 text-purple-200",
  donations_top: "border-amber-500 bg-amber-500/15 text-amber-200",
  officer_pick: "border-slate-400 bg-slate-500/15 text-slate-200",
  event_top_x_lottery: "border-pink-500 bg-pink-500/15 text-pink-200",
  custom: "border-slate-500 bg-slate-500/15 text-slate-200",
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
  economy_week: {
    swatch: "bg-red-500",
    ring: "ring-red-500",
  },
  price_is_right: {
    swatch: "bg-cyan-500",
    ring: "ring-cyan-500",
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
