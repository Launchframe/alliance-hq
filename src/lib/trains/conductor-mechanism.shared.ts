import { isAutomaticTopNBoard, resolveConductorTopNBoard } from "@/lib/trains/conductor-top-n.shared";
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
  if (paintTemplate === "top_vs") {
    return "vs_top_n";
  }
  if (paintTemplate === "top_vr") {
    return "vr_top_n";
  }
  if (!conductorMechanism) return null;
  return conductorMechanism as ConductorMechanismType;
}

/** Stable key for whether today's conductor draw rules changed (mechanism / paint / top-N). */
export function conductorDrawIdentity(input: {
  conductorMechanism: string | null | undefined;
  paintTemplate?: WeekTemplateType | string | null;
  date?: string | null;
  conductorConfig?: unknown;
  topN?: number | null;
}): string {
  const mechanism = effectiveConductorMechanism(
    input.conductorMechanism,
    input.paintTemplate as WeekTemplateType | null,
    input.date,
  );
  if (!mechanism) return "";

  let topN = input.topN ?? null;
  if (
    topN == null &&
    input.conductorConfig &&
    typeof input.conductorConfig === "object" &&
    "topN" in input.conductorConfig
  ) {
    const raw = (input.conductorConfig as { topN?: unknown }).topN;
    if (typeof raw === "number") topN = raw;
  }

  return [mechanism, input.paintTemplate ?? "", topN ?? ""].join("|");
}

export function conductorDrawChanged(
  before: Parameters<typeof conductorDrawIdentity>[0],
  after: Parameters<typeof conductorDrawIdentity>[0],
): boolean {
  return conductorDrawIdentity(before) !== conductorDrawIdentity(after);
}

/** Pending pick from an older draw mechanism does not count as today's conductor. */
export function hasValidConductorPickForDay(input: {
  conductorMemberId: string | null | undefined;
  recordConductorMechanism: string | null | undefined;
  dayConductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  date?: string | null;
  conductorConfig?: unknown;
  topN?: number | null;
}): boolean {
  if (!input.conductorMemberId) return false;
  if (!input.recordConductorMechanism) return true;

  const dayMechanism = effectiveConductorMechanism(
    input.dayConductorMechanism,
    input.paintTemplate as WeekTemplateType | null,
    input.date,
  );
  return input.recordConductorMechanism === dayMechanism;
}

export function canSpinConductorForDay(
  conductorMechanism: string | null | undefined,
  locked: boolean,
  paintTemplate?: WeekTemplateType | null,
  date?: string | null,
  conductorConfig?: unknown,
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
  if (mechanism === "donations_top") {
    return false;
  }
  const topBoard = resolveConductorTopNBoard(mechanism, conductorConfig);
  if (isAutomaticTopNBoard(topBoard)) {
    return false;
  }
  return mechanismNeedsWheel(mechanism, conductorConfig);
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
