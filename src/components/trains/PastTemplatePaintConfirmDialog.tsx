"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  dates: string[];
  templateType: WeekTemplateType;
  templateLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function PastTemplatePaintConfirmDialog({
  open,
  dates,
  templateLabel,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const t = useTranslations("trains.pastPaintConfirm");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      title={t("title")}
    >
      <div className="space-y-4">
        <p className="text-sm text-hq-fg-muted">
          {t("body", { template: templateLabel, count: dates.length })}
        </p>
        <ul className="max-h-32 list-inside list-disc overflow-y-auto rounded-md border border-hq-border bg-hq-canvas p-2 text-xs text-[#c9d1d9]">
          {dates.map((date) => (
            <li key={date}>{date}</li>
          ))}
        </ul>
        <p className="text-xs text-hq-fg-muted">{t("hint")}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            {t("cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {busy ? t("confirming") : t("confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
