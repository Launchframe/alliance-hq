"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { MarkerConflictNotice } from "@/components/battle-plan/MarkerConflictNotice";
import { MarkerIconPalette } from "@/components/battle-plan/MarkerIconPalette";
import {
  findMarkerPresetConflict,
  collectUsedMarkerPresets,
} from "@/lib/battle-plan/marker-conflict.shared";
import {
  markerPresetI18nKey,
  type MarkerIconPreset,
} from "@/lib/battle-plan/marker-icons.shared";
import type { BattlePlanTimeDisplay } from "@/lib/battle-plan/time-display.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

type Props = {
  label: string;
  value: MarkerIconPreset | null;
  events: readonly SerializedCaptureEvent[];
  timeDisplay: BattlePlanTimeDisplay;
  excludeEventId?: string;
  disabled?: boolean;
  onChange: (preset: MarkerIconPreset | null) => void;
  onOpenConflictEvent?: (event: SerializedCaptureEvent) => void;
};

export function MarkerAssignmentField({
  label,
  value,
  events,
  timeDisplay,
  excludeEventId,
  disabled = false,
  onChange,
  onOpenConflictEvent,
}: Props) {
  const t = useTranslations("battlePlan");
  const tMarkers = useTranslations("bankManagement.markers");

  const usedPresets = useMemo(
    () => collectUsedMarkerPresets(events, { excludeEventId }),
    [events, excludeEventId],
  );

  const conflict = useMemo(
    () =>
      findMarkerPresetConflict(events, value, {
        excludeEventId,
      }),
    [events, excludeEventId, value],
  );

  const markerLabel = value
    ? t(`markers.presets.${markerPresetI18nKey(value)}`)
    : "";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-hq-fg">{label}</p>
      <MarkerIconPalette
        value={value}
        usedPresets={usedPresets}
        disabled={disabled}
        onChange={onChange}
      />
      {conflict && value && onOpenConflictEvent ? (
        <MarkerConflictNotice
          markerLabel={markerLabel}
          conflictingEvent={conflict}
          timeDisplay={timeDisplay}
          onOpenEvent={onOpenConflictEvent}
        />
      ) : null}
      {!value ? (
        <p className="text-xs text-hq-fg-muted">{tMarkers("pickHint")}</p>
      ) : null}
    </div>
  );
}
