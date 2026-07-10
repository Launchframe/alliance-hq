"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
import type {
  SerializedBattlePlanMarker,
  SerializedCaptureEvent,
} from "@/lib/battle-plan/types.shared";
import { listUpcomingCaptureEvents } from "@/lib/battle-plan/display.shared";

type Props = {
  events: SerializedCaptureEvent[];
  markers: SerializedBattlePlanMarker[];
  onSelect?: (event: SerializedCaptureEvent) => void;
  canWrite: boolean;
};

export function UpcomingCapturesList({
  events,
  markers,
  onSelect,
  canWrite,
}: Props) {
  const t = useTranslations("battlePlan");
  const upcoming = useMemo(() => listUpcomingCaptureEvents(events), [events]);
  const markerColors = useMemo(
    () => new Map(markers.map((marker) => [marker.markerNumber, marker.colorHex])),
    [markers],
  );

  if (upcoming.length === 0) {
    return (
      <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
        {t("upcoming.empty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-hq-fg">{t("upcoming.title")}</h2>
      <ul className="space-y-2">
        {upcoming.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onSelect?.(event)}
              disabled={!canWrite || !onSelect}
              className={`w-full rounded-lg border border-hq-border bg-hq-surface p-3 text-left text-sm ${
                canWrite && onSelect
                  ? "hover:border-hq-accent"
                  : "cursor-default"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium text-hq-fg">
                  <MarkerBadge
                    markerNumber={event.markerNumber}
                    colorHex={
                      markerColors.get(event.markerNumber) ?? "#64748b"
                    }
                    size="sm"
                  />
                  {event.territoryType === "stronghold"
                    ? t("event.stronghold")
                    : t("event.city")}
                </span>
                <span className="text-xs text-hq-fg-muted">
                  {new Date(event.scheduledAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-xs text-hq-fg-subtle">
                {t("event.policyLine", {
                  policy:
                    event.effectiveCapturePolicy === "peace"
                      ? t("settings.policyPeace")
                      : t("settings.policyWar"),
                })}
              </p>
              {event.notes ? (
                <p className="mt-1 text-xs text-hq-fg-muted">{event.notes}</p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
