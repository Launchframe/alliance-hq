"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  weekStart: string;
  weekEnd: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ClearWeekScheduleDialog({
  open,
  weekStart,
  weekEnd,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const t = useTranslations("trains.clearWeekSchedule");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      title={t("title")}
    >
      <div className="space-y-4">
        <p className="text-sm text-[#8b949e]">
          {t("body", { weekStart, weekEnd })}
        </p>
        <p className="text-xs text-[#8b949e]">{t("hint")}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
            data-testid="trains-clear-week-confirm"
          >
            {busy ? t("confirming") : t("confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
