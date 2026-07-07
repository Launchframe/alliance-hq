import {
  MECHANISM_STYLES,
  mechanismStyleClass,
} from "@/lib/trains/mechanism-styles";
import type { WeekTemplateType } from "@/lib/trains/types";
import { WEEK_TEMPLATES } from "@/lib/trains/types";

export type ConductorConfigPayload = {
  paintTemplate?: WeekTemplateType;
};

const TEMPLATE_CELL_STYLES: Partial<Record<WeekTemplateType, string>> = {
  vs_push_weekdays: MECHANISM_STYLES.vs_top_10,
  r4_event_vip: "border-slate-300 bg-slate-400/15 text-slate-100",
  economy_week: "border-red-500 bg-red-500/15 text-red-200",
  price_is_right: "border-cyan-500 bg-cyan-500/15 text-cyan-200",
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
  if (paintTemplate === "price_is_right") {
    return TEMPLATE_CELL_STYLES.price_is_right!;
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
  const withoutBg = style.replace(/\bbg-[\w-]+(?:\/[\d.]+)?\b/g, "").trim();
  return `${withoutBg} bg-hq-surface`;
}

export function withPaintTemplateConfig<T extends { conductorConfig?: unknown }>(
  config: T,
  templateType: WeekTemplateType,
): T & { conductorConfig: ConductorConfigPayload } {
  return {
    ...config,
    conductorConfig: { paintTemplate: templateType },
  };
}
