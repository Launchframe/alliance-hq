import {
  MECHANISM_STYLES,
  mechanismStyleClass,
} from "@/lib/trains/mechanism-styles";
import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import { WEEK_TEMPLATES } from "@/lib/trains/types";

export type ConductorConfigPayload = {
  paintTemplate?: WeekTemplateType;
  /** Top VS / Top VR scope when mechanism is vs_top_n / vr_top_n. */
  topN?: number;
};

const TEMPLATE_CELL_STYLES: Partial<Record<WeekTemplateType, string>> = {
  vs_push_weekdays: MECHANISM_STYLES.vs_top_10,
  r4_event_vip:
    "border-slate-300 bg-slate-400/15 text-slate-100 light:bg-slate-100 light:text-slate-700",
  top_vs: MECHANISM_STYLES.vs_top_n,
  top_vr: MECHANISM_STYLES.vr_top_n,
  economy_week:
    "border-red-500 bg-red-500/15 text-red-200 light:bg-red-100 light:text-red-800",
  price_is_right:
    "border-cyan-500 bg-cyan-500/15 text-cyan-200 light:bg-cyan-100 light:text-cyan-800",
  price_is_right_weekdays:
    "border-cyan-500 bg-cyan-500/15 text-cyan-200 light:bg-cyan-100 light:text-cyan-800",
  takedown_week:
    "border-cyan-400 bg-cyan-400/15 text-cyan-100 light:bg-cyan-100 light:text-cyan-800",
  r3_recognition: MECHANISM_STYLES.r3_lottery,
  r4_train_week: MECHANISM_STYLES.r4_sequence,
  donations_week: MECHANISM_STYLES.donations_top,
  custom: MECHANISM_STYLES.custom,
};

export function paintTemplateFromConductorConfig(
  conductorConfig: unknown,
): WeekTemplateType | null {
  if (!conductorConfig || typeof conductorConfig !== "object") return null;
  const paintTemplate = (conductorConfig as ConductorConfigPayload).paintTemplate;
  if (
    typeof paintTemplate === "string" &&
    WEEK_TEMPLATES.includes(paintTemplate as WeekTemplateType)
  ) {
    return paintTemplate as WeekTemplateType;
  }
  return null;
}

/** Calendar cells: economy week is red even though it shares the r3_lottery mechanism. */
export function calendarCellStyleClass(
  conductorMechanism: string,
  paintTemplate?: WeekTemplateType | null,
): string {
  if (paintTemplate === "economy_week") {
    return TEMPLATE_CELL_STYLES.economy_week!;
  }
  if (isPriceIsRightPaintTemplate(paintTemplate)) {
    return TEMPLATE_CELL_STYLES.price_is_right_weekdays!;
  }
  if (paintTemplate === "vs_push_week") {
    return mechanismStyleClass(conductorMechanism);
  }
  if (paintTemplate) {
    const templateStyle = TEMPLATE_CELL_STYLES[paintTemplate];
    if (templateStyle) return templateStyle;
  }
  return mechanismStyleClass(conductorMechanism);
}

/** Solid fill for 3D carousel tiles — transparent mechanism tints bleed through stacked cards. */
export function calendarCellOpaqueStyleClass(
  conductorMechanism: string,
  paintTemplate?: WeekTemplateType | null,
): string {
  const style = calendarCellStyleClass(conductorMechanism, paintTemplate);
  const withoutBg = style
    .replace(/\blight:bg-[\w-]+(?:\/[\d.]+)?\b/g, "")
    .replace(/\bdark:bg-[\w-]+(?:\/[\d.]+)?\b/g, "")
    .replace(/\bbg-[\w-]+(?:\/[\d.]+)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${withoutBg} bg-hq-surface`;
}

export function withPaintTemplateConfig<T extends { conductorConfig?: unknown }>(
  config: T,
  templateType: WeekTemplateType,
  extras?: { topN?: number },
): T & { conductorConfig: ConductorConfigPayload } {
  const existing =
    config.conductorConfig && typeof config.conductorConfig === "object"
      ? (config.conductorConfig as ConductorConfigPayload)
      : {};
  const topN =
    extras?.topN ??
    (typeof existing.topN === "number" ? existing.topN : undefined);
  return {
    ...config,
    conductorConfig: {
      paintTemplate: templateType,
      ...(topN != null ? { topN } : {}),
    },
  };
}
