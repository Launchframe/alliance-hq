import { mechanismNeedsWheel } from "@/lib/trains/templates";
import { isPriceIsRightHeavyHitterSaturday } from "@/lib/trains/heavy-hitter-pool.shared";
import type { ConductorMechanismType, WeekTemplateType } from "@/lib/trains/types";

/** Conductor mechanism used for rolls, pool reseed, and spin-wheel UI. */
export function effectiveConductorMechanism(
  conductorMechanism: string | null | undefined,
  paintTemplate?: WeekTemplateType | null,
  date?: string | null,
): ConductorMechanismType | null {
  if (isPriceIsRightHeavyHitterSaturday(paintTemplate, date)) {
    return "heavy_hitter_lottery";
  }
  if (paintTemplate === "r4_event_vip") {
    return "r4_sequence";
  }
  if (!conductorMechanism) return null;
  return conductorMechanism as ConductorMechanismType;
}

export function canSpinConductorForDay(
  conductorMechanism: string | null | undefined,
  locked: boolean,
  paintTemplate?: WeekTemplateType | null,
  date?: string | null,
): boolean {
  if (locked) return false;
  // R3 recognition is a manual award pick from the R3 pool — no wheel.
  if (paintTemplate === "r3_recognition") return false;
  const mechanism = effectiveConductorMechanism(
    conductorMechanism,
    paintTemplate,
    date,
  );
  if (!mechanism) return false;
  if (mechanism === "vs_high_score" || mechanism === "donations_top") {
    return false;
  }
  return mechanismNeedsWheel(mechanism);
}

export function canSpinVipForDay(
  vipMechanism: string | null | undefined,
  locked: boolean,
): boolean {
  if (locked || !vipMechanism) return false;
  return (
    vipMechanism === "donations_second" || vipMechanism === "event_top_x_lottery"
  );
}
