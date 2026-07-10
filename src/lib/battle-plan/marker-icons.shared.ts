import type { BattlePlanMarkerNumber } from "@/lib/battle-plan/types.shared";

export const MARKER_ICON_PRESETS = [
  "crossed-swords",
  "hammer",
  "sun",
  "star-4",
  "clover",
  "shield",
  "triangle",
  "crescent",
  "star-5",
  "hexagon",
  "square",
  "circle",
  "parallelogram",
  "trapezoid",
  "ordinal-1",
  "ordinal-2",
  "ordinal-3",
  "ordinal-4",
  "ordinal-5",
] as const;

export type MarkerIconPreset = (typeof MARKER_ICON_PRESETS)[number];

export const DEFAULT_MARKER_ICON_PRESETS: Record<
  BattlePlanMarkerNumber,
  MarkerIconPreset
> = {
  1: "ordinal-1",
  2: "ordinal-2",
  3: "ordinal-3",
  4: "ordinal-4",
  5: "ordinal-5",
};

export const MARKER_PRESET_I18N_KEYS: Record<MarkerIconPreset, string> = {
  "crossed-swords": "crossedSwords",
  hammer: "hammer",
  sun: "sun",
  "star-4": "star4",
  clover: "clover",
  shield: "shield",
  triangle: "triangle",
  crescent: "crescent",
  "star-5": "star5",
  hexagon: "hexagon",
  square: "square",
  circle: "circle",
  parallelogram: "parallelogram",
  trapezoid: "trapezoid",
  "ordinal-1": "ordinal1",
  "ordinal-2": "ordinal2",
  "ordinal-3": "ordinal3",
  "ordinal-4": "ordinal4",
  "ordinal-5": "ordinal5",
};

const PRESET_SET = new Set<string>(MARKER_ICON_PRESETS);

export function isMarkerIconPreset(value: string): value is MarkerIconPreset {
  return PRESET_SET.has(value);
}

export function resolveMarkerIconPreset(
  markerNumber: BattlePlanMarkerNumber,
  storedPreset: string | null | undefined,
): MarkerIconPreset {
  if (storedPreset && isMarkerIconPreset(storedPreset)) {
    return storedPreset;
  }
  return DEFAULT_MARKER_ICON_PRESETS[markerNumber];
}

export function markerPresetI18nKey(preset: MarkerIconPreset): string {
  return MARKER_PRESET_I18N_KEYS[preset];
}
