"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { CopyShareMessageField } from "@/components/ui/CopyShareMessageField";
import { Dialog } from "@/components/ui/dialog";
import {
  buildAnnouncementStrings,
  generateBattlePlanAnnouncement,
} from "@/lib/battle-plan/announcement.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: SerializedCaptureEvent[];
  effectiveSeasonKey?: string;
};

export function BattlePlanAnnouncementDialog({
  open,
  onOpenChange,
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
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("announcement.title")}
      className="max-w-xl"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("announcement.title")}
          </h2>
          <p className="mt-1 text-sm text-hq-fg-muted">
            {t("announcement.subtitle")}
          </p>
        </div>
        <CopyShareMessageField
          message={message}
          label={t("announcement.copyLabel")}
          copyButtonPlacement="above"
        />
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded border border-hq-border px-4 py-2 text-sm text-hq-fg"
            onClick={() => onOpenChange(false)}
          >
            {t("actions.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
