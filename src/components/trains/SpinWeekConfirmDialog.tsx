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
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("confirmTitle")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
            {t("confirmBody", { count: results.length })}
          </p>
        </div>

        <ul className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-hq-border bg-hq-canvas p-3">
          {results.map((row) => (
            <li
              key={row.date}
              className="flex flex-col gap-0.5 border-b border-hq-border/60 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <span className="text-sm font-medium text-hq-fg">
                {row.dayLabel}
              </span>
              <span className="text-sm text-hq-fg-muted">{row.memberName}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-60"
          >
            {t("confirmCancel")}
          </button>
          <button
            type="button"
            disabled={busy || results.length === 0}
            onClick={onConfirm}
            className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-60"
          >
            {busy ? t("confirmLocking") : t("confirmLockAll")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
