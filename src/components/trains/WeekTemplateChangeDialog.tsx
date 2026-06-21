"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import {
  formatTrainScheduleDateLabel,
  restOfWeekPaintDates,
} from "@/lib/trains/week-template-change.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  templateType: WeekTemplateType | null;
  weekStart: string | null;
  weekEnd: string | null;
  today: string;
  lockedThroughDate: string | null;
  onConfirm: (options: { includeToday: boolean; dates: string[] }) => void;
  onClose: () => void;
};

export function WeekTemplateChangeDialog({
  open,
  templateType,
  weekStart,
  weekEnd,
  today,
  lockedThroughDate,
  onConfirm,
  onClose,
}: Props) {
  const t = useTranslations("trains.templateChangeConfirm");
  const tTrains = useTranslations("trains");
  const [includeToday, setIncludeToday] = useState(false);

  if (!templateType || !weekStart || !weekEnd) return null;

  const templateLabel = tTrains(`templates.${templateType}`);
  const dates = restOfWeekPaintDates({
    weekStart,
    weekEnd,
    today,
    includeToday,
    lockedThroughDate,
  });
  const firstPaintDate = dates[0] ?? null;
  const lastPaintDate = dates[dates.length - 1] ?? null;
  const lockedLabel = lockedThroughDate
    ? formatTrainScheduleDateLabel(lockedThroughDate)
    : null;

  const body =
    dates.length === 0
      ? t("noDatesBody")
      : lockedLabel
        ? t("bodyWithLocks", {
            cutoffDate: lockedLabel,
            template: templateLabel,
            startDate: formatTrainScheduleDateLabel(firstPaintDate!),
            endDate: formatTrainScheduleDateLabel(lastPaintDate!),
          })
        : t("body", {
            template: templateLabel,
            startDate: formatTrainScheduleDateLabel(firstPaintDate!),
            endDate: formatTrainScheduleDateLabel(lastPaintDate!),
          });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setIncludeToday(false);
          onClose();
        }
      }}
      title={t("title")}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">{body}</p>
        </div>

        {dates.length > 0 && today >= weekStart && today <= weekEnd ? (
          <label className="flex items-start gap-2 text-sm text-[#e6edf3]">
            <input
              type="checkbox"
              checked={includeToday}
              onChange={(e) => setIncludeToday(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t("includeToday", { date: formatTrainScheduleDateLabel(today) })}</span>
          </label>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => {
              setIncludeToday(false);
              onClose();
            }}
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={dates.length === 0}
            onClick={() => {
              onConfirm({ includeToday, dates });
              setIncludeToday(false);
            }}
            className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-60"
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
