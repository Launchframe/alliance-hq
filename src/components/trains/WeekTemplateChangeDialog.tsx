"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { formatTrainScheduleDateLabel } from "@/lib/trains/week-template-change.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  templateType: WeekTemplateType | null;
  cutoffDate: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export function WeekTemplateChangeDialog({
  open,
  templateType,
  cutoffDate,
  onConfirm,
  onClose,
}: Props) {
  const t = useTranslations("trains");

  if (!templateType || !cutoffDate) return null;

  const cutoffLabel = formatTrainScheduleDateLabel(cutoffDate);
  const templateLabel = t(`templates.${templateType}`);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("templateChangeConfirm.title")}
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
            {t("templateChangeConfirm.body", {
              cutoffDate: cutoffLabel,
              template: templateLabel,
            })}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
          >
            {t("templateChangeConfirm.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
          >
            {t("templateChangeConfirm.confirm")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
