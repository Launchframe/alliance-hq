"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { conductorSwapCandidates } from "@/lib/trains/conductor-swap.shared";
import { spinWeekDayLabel } from "@/lib/trains/spin-week.shared";
import type {
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
} from "@/lib/trains/load-dashboard";

type Props = {
  open: boolean;
  sourceDate: string;
  sourceRecord: WeekConductorRecordSummary;
  dayConfigs: WeekScheduleDayConfig[];
  weekRecords: WeekConductorRecordSummary[];
  busy?: boolean;
  onConfirm: (targetDate: string) => void;
  onClose: () => void;
};

export function ConductorSwapDialog({
  open,
  sourceDate,
  sourceRecord,
  dayConfigs,
  weekRecords,
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  const t = useTranslations("trains.swap");
  const [targetDate, setTargetDate] = useState<string | null>(null);

  const candidates = useMemo(
    () => conductorSwapCandidates({ sourceDate, dayConfigs, weekRecords }),
    [dayConfigs, sourceDate, weekRecords],
  );

  const selectedTarget = candidates.find((record) => record.date === targetDate);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTargetDate(null);
          onClose();
        }
      }}
      title={t("title")}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
            {t("body")}
          </p>
        </div>

        <div className="rounded-lg border border-hq-border bg-hq-canvas p-3">
          <p className="text-xs uppercase tracking-wide text-hq-fg-muted">
            {t("thisDay")}
          </p>
          <p className="mt-1 text-sm font-medium text-hq-fg">
            {spinWeekDayLabel(sourceDate)}
          </p>
          <p className="mt-0.5 text-sm text-hq-accent">
            {sourceRecord.conductorMemberName}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
            {t("swapWith")}
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-hq-fg-muted">{t("noCandidates")}</p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {candidates.map((record) => {
                const selected = targetDate === record.date;
                return (
                  <li key={record.date}>
                    <button
                      type="button"
                      onClick={() => setTargetDate(record.date)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-[#8957e5] bg-[#8957e5]/10"
                          : "border-hq-border bg-hq-surface hover:bg-hq-canvas"
                      }`}
                    >
                      <div className="text-sm font-medium text-hq-fg">
                        {spinWeekDayLabel(record.date)}
                      </div>
                      <div className="text-sm text-hq-fg-muted">
                        {record.conductorMemberName ?? t("noConductorYet")}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedTarget ? (
          <p className="text-sm text-[#c9d1d9]">
            {selectedTarget.conductorMemberName
              ? t("preview", {
                  dayA: spinWeekDayLabel(sourceDate),
                  nameA: sourceRecord.conductorMemberName ?? "",
                  dayB: spinWeekDayLabel(selectedTarget.date),
                  nameB: selectedTarget.conductorMemberName,
                })
              : t("previewMoveToOpen", {
                  dayA: spinWeekDayLabel(sourceDate),
                  nameA: sourceRecord.conductorMemberName ?? "",
                  dayB: spinWeekDayLabel(selectedTarget.date),
                })}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setTargetDate(null);
              onClose();
            }}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-60"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !targetDate}
            onClick={() => {
              if (!targetDate) return;
              onConfirm(targetDate);
            }}
            className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-60"
          >
            {busy ? t("swapping") : t("confirm")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
