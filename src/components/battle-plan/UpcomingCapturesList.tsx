"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
import { listUpcomingCaptureEvents } from "@/lib/battle-plan/display.shared";
import {
  formatCaptureDateTime,
  type BattlePlanTimeDisplay,
} from "@/lib/battle-plan/time-display.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

type Props = {
  events: SerializedCaptureEvent[];
  timeDisplay: BattlePlanTimeDisplay;
  canWrite: boolean;
  onSelect?: (event: SerializedCaptureEvent) => void;
};

export function UpcomingCapturesList({
  events,
  timeDisplay,
  onSelect,
  canWrite,
}: Props) {
  const t = useTranslations("battlePlan");
  const upcoming = useMemo(() => listUpcomingCaptureEvents(events), [events]);

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
                  {event.iconPreset ? (
                    <MarkerBadge iconPreset={event.iconPreset} size="sm" />
                  ) : null}
                  {event.eventType === "drop"
                    ? t("event.drop")
                    : event.territoryType === "stronghold"
                      ? t("event.stronghold")
                      : t("event.city")}
                </span>
                <span className="text-xs text-hq-fg-muted">
                  {formatCaptureDateTime(event.scheduledAt, timeDisplay)}
                </span>
              </div>
              {event.eventType === "drop" ? (
                <p className="mt-1 text-xs text-hq-fg-subtle">
                  {t("event.dropHint")}
                </p>
              ) : (
                <p className="mt-1 text-xs text-hq-fg-subtle">
                  {t("event.policyLine", {
                    policy:
                      event.effectiveCapturePolicy === "peace"
                        ? t("settings.policyPeace")
                        : t("settings.policyWar"),
                  })}
                </p>
              )}
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
