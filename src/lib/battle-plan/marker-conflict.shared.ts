import {
  MARKER_ICON_PRESETS,
  ORDINAL_MARKER_PRESETS,
  type MarkerIconPreset,
} from "@/lib/battle-plan/marker-icons.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

/** Prefer ordinals first when auto-selecting the next free marker. */
export const AUTO_SELECT_MARKER_ORDER: MarkerIconPreset[] = [
  ...ORDINAL_MARKER_PRESETS,
  ...MARKER_ICON_PRESETS.filter(
    (preset) =>
      !(ORDINAL_MARKER_PRESETS as readonly string[]).includes(preset),
  ),
];

type MarkerConflictOptions = {
  excludeEventId?: string;
  now?: Date;
};

function reservesMarkerPreset(
  event: SerializedCaptureEvent,
  nowMs: number,
): event is SerializedCaptureEvent & { iconPreset: MarkerIconPreset } {
  return (
    event.status === "scheduled" &&
    event.iconPreset != null &&
    new Date(event.scheduledAt).getTime() >= nowMs
  );
}

export function findMarkerPresetConflict(
  events: readonly SerializedCaptureEvent[],
  iconPreset: MarkerIconPreset | null,
  options: MarkerConflictOptions = {},
): SerializedCaptureEvent | null {
  if (!iconPreset) {
    return null;
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const conflicts = events.filter(
    (event) =>
      event.id !== options.excludeEventId &&
      event.iconPreset === iconPreset &&
      reservesMarkerPreset(event, nowMs),
  );

  conflicts.sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  return conflicts[0] ?? null;
}

export function collectUsedMarkerPresets(
  events: readonly SerializedCaptureEvent[],
  options: MarkerConflictOptions = {},
): ReadonlySet<MarkerIconPreset> {
  const nowMs = (options.now ?? new Date()).getTime();
  const used = new Set<MarkerIconPreset>();
  for (const event of events) {
    if (event.id === options.excludeEventId) continue;
    if (reservesMarkerPreset(event, nowMs)) {
      used.add(event.iconPreset);
    }
  }
  return used;
}

export function findNextAvailableMarkerPreset(
  events: readonly SerializedCaptureEvent[],
  options: MarkerConflictOptions = {},
): MarkerIconPreset {
  const used = collectUsedMarkerPresets(events, options);
  for (const preset of AUTO_SELECT_MARKER_ORDER) {
    if (!used.has(preset)) {
      return preset;
    }
  }
  return AUTO_SELECT_MARKER_ORDER[0];
}
