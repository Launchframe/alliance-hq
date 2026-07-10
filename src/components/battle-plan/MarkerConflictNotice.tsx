"use client";

import { useTranslations } from "next-intl";

import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

type Props = {
  markerLabel: string;
  conflictingEvent: SerializedCaptureEvent;
  onOpenEvent: (event: SerializedCaptureEvent) => void;
};

export function MarkerConflictNotice({
  markerLabel,
  conflictingEvent,
  onOpenEvent,
}: Props) {
  const t = useTranslations("battlePlan");
  const dateTime = new Date(conflictingEvent.scheduledAt).toLocaleString();
  const territoryTypeLabel =
    conflictingEvent.territoryType === "stronghold"
      ? t("event.stronghold")
      : t("event.city");
  const captureSummary = t("event.captureSummary", {
    territoryType: territoryTypeLabel,
    dateTime,
  });

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-hq-fg">
      <p>
        {t.rich("event.markerInUse", {
          markerLabel,
          link: (chunks) => (
            <button
              type="button"
              className="font-medium text-hq-accent underline underline-offset-2"
              onClick={() => onOpenEvent(conflictingEvent)}
            >
              {chunks}
            </button>
          ),
          captureSummary,
        })}
      </p>
      <p className="mt-2 text-xs text-hq-fg-muted">{t("event.markerSaveHint")}</p>
    </div>
  );
}
