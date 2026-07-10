"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { CopyShareMessageField } from "@/components/ui/CopyShareMessageField";
import {
  buildAnnouncementStrings,
  generateBattlePlanAnnouncement,
} from "@/lib/battle-plan/announcement.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

type Props = {
  events: SerializedCaptureEvent[];
  effectiveSeasonKey?: string;
};

export function BattlePlanAnnouncementPanel({
  events,
  effectiveSeasonKey,
}: Props) {
  const t = useTranslations("battlePlan");
  const message = useMemo(() => {
    const strings = buildAnnouncementStrings((key, values) =>
      t(key, values),
    );
    return generateBattlePlanAnnouncement(events, {
      seasonKey: effectiveSeasonKey ?? "1",
      strings,
    });
  }, [events, effectiveSeasonKey, t]);

  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-hq-fg">
          {t("announcement.title")}
        </h2>
        <p className="mt-1 text-xs text-hq-fg-muted">
          {t("announcement.subtitle")}
        </p>
      </div>
      <CopyShareMessageField
        message={message}
        label={t("announcement.copyLabel")}
      />
    </div>
  );
}
