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
          <h2 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
            {t("body")}
          </p>
        </div>

        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
          <p className="text-xs uppercase tracking-wide text-[#8b949e]">
            {t("thisDay")}
          </p>
          <p className="mt-1 text-sm font-medium text-[#e6edf3]">
            {spinWeekDayLabel(sourceDate)}
          </p>
          <p className="mt-0.5 text-sm text-[#58a6ff]">
            {sourceRecord.conductorMemberName}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
            {t("swapWith")}
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-[#8b949e]">{t("noCandidates")}</p>
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
                          : "border-[#30363d] bg-[#161b22] hover:bg-[#0d1117]"
                      }`}
                    >
                      <div className="text-sm font-medium text-[#e6edf3]">
                        {spinWeekDayLabel(record.date)}
                      </div>
                      <div className="text-sm text-[#8b949e]">
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
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-60"
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
            className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-60"
          >
            {busy ? t("swapping") : t("confirm")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
