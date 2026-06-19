"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import type { SpinWeekResultRow } from "@/lib/trains/spin-week.shared";

type Props = {
  open: boolean;
  results: SpinWeekResultRow[];
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function SpinWeekConfirmDialog({
  open,
  results,
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  const t = useTranslations("trains.spinWeek");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("confirmTitle")}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3]">
            {t("confirmTitle")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
            {t("confirmBody", { count: results.length })}
          </p>
        </div>

        <ul className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
          {results.map((row) => (
            <li
              key={row.date}
              className="flex flex-col gap-0.5 border-b border-[#30363d]/60 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <span className="text-sm font-medium text-[#e6edf3]">
                {row.dayLabel}
              </span>
              <span className="text-sm text-[#8b949e]">{row.memberName}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-60"
          >
            {t("confirmCancel")}
          </button>
          <button
            type="button"
            disabled={busy || results.length === 0}
            onClick={onConfirm}
            className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-60"
          >
            {busy ? t("confirmLocking") : t("confirmLockAll")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
