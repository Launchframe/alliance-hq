export const MARKER_ICON_PRESETS = [
  "crossed-swords",
  "hammer",
  "sun",
  "star-4",
  "clover",
  "shield",
  "triangle",
  "diamond",
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

export const ORDINAL_MARKER_PRESETS = [
  "ordinal-1",
  "ordinal-2",
  "ordinal-3",
  "ordinal-4",
  "ordinal-5",
] as const satisfies readonly MarkerIconPreset[];

export const MARKER_PRESET_I18N_KEYS: Record<MarkerIconPreset, string> = {
  "crossed-swords": "crossedSwords",
  hammer: "hammer",
  sun: "sun",
  "star-4": "twinkle",
  clover: "clover",
  shield: "shield",
  triangle: "triangle",
  diamond: "diamond",
  crescent: "crescent",
  "star-5": "star",
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

export function markerPresetI18nKey(preset: MarkerIconPreset): string {
  return MARKER_PRESET_I18N_KEYS[preset];
}

export function markerPresetLabel(
  preset: MarkerIconPreset,
  translate: (key: string) => string,
): string {
  return translate(`markers.presets.${markerPresetI18nKey(preset)}`);
}
