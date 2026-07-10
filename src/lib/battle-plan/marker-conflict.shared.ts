import type {
  BattlePlanMarkerNumber,
  SerializedCaptureEvent,
} from "@/lib/battle-plan/types.shared";
import {
  DEFAULT_MARKER_ICON_PRESETS,
  type MarkerIconPreset,
} from "@/lib/battle-plan/marker-icons.shared";

export function findFutureMarkerConflict(
  events: readonly SerializedCaptureEvent[],
  markerNumber: BattlePlanMarkerNumber,
  options: {
    excludeEventId?: string;
    now?: Date;
  } = {},
): SerializedCaptureEvent | null {
  const nowMs = (options.now ?? new Date()).getTime();
  const conflicts = events.filter(
    (event) =>
      event.status === "scheduled" &&
      event.markerNumber === markerNumber &&
      event.id !== options.excludeEventId &&
      new Date(event.scheduledAt).getTime() >= nowMs,
  );

  conflicts.sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  return conflicts[0] ?? null;
}

export function resolveMarkerLabel(
  markers: ReadonlyArray<{ markerNumber: number; iconPreset: MarkerIconPreset }>,
  markerNumber: BattlePlanMarkerNumber,
  getPresetLabel: (preset: MarkerIconPreset) => string,
): string {
  const marker = markers.find((row) => row.markerNumber === markerNumber);
  const preset =
    marker?.iconPreset ?? DEFAULT_MARKER_ICON_PRESETS[markerNumber];
  return getPresetLabel(preset);
}
