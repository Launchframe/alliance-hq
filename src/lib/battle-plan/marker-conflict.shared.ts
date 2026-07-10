import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

export function findMarkerPresetConflict(
  events: readonly SerializedCaptureEvent[],
  iconPreset: MarkerIconPreset | null,
  options: {
    excludeEventId?: string;
  } = {},
): SerializedCaptureEvent | null {
  if (!iconPreset) {
    return null;
  }

  const conflicts = events.filter(
    (event) =>
      event.status === "scheduled" &&
      event.iconPreset === iconPreset &&
      event.id !== options.excludeEventId,
  );

  conflicts.sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  return conflicts[0] ?? null;
}

export function collectUsedMarkerPresets(
  events: readonly SerializedCaptureEvent[],
  options: { excludeEventId?: string } = {},
): ReadonlySet<MarkerIconPreset> {
  const used = new Set<MarkerIconPreset>();
  for (const event of events) {
    if (event.status !== "scheduled") continue;
    if (event.id === options.excludeEventId) continue;
    if (event.iconPreset) {
      used.add(event.iconPreset);
    }
  }
  return used;
}
