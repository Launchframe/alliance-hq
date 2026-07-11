"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { defaultDatetimeLocalValue } from "@/components/banks/datetime-local";
import type { RecommendedDropMetrics } from "@/lib/banks/types.shared";

type Props = {
  recommendation: RecommendedDropMetrics | null;
  canWrite: boolean;
  scheduling: boolean;
  onScheduleDrop: (bankId: string, scheduledAtLocalValue: string) => Promise<void>;
};

export function RecommendedDropCard({
  recommendation,
  canWrite,
  scheduling,
  onScheduleDrop,
}: Props) {
  const t = useTranslations("bankManagement");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() =>
    defaultDatetimeLocalValue(30),
  );

  if (!recommendation) {
    return (
      <div className="space-y-2 rounded-lg border border-hq-border bg-hq-surface p-4">
        <h2 className="text-sm font-semibold text-hq-fg">
          {t("recommendedTitle")}
        </h2>
        <p className="text-sm text-hq-fg-muted">{t("recommendedEmpty")}</p>
      </div>
    );
  }

  const { bank, valueAtRisk, countAtRisk, hoursUntilAllMature, reasons } =
    recommendation;

  return (
    <div className="space-y-3 rounded-lg border border-hq-accent/40 bg-hq-accent/5 p-4">
      <div>
        <h2 className="text-sm font-semibold text-hq-fg">
          {t("recommendedTitle")}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-medium text-hq-fg">
            {t("coords", {
              server: bank.gameServerNumber,
              x: bank.coordX,
              y: bank.coordY,
            })}
          </span>
          <span className="rounded-full border border-hq-border px-2 py-0.5 text-xs text-hq-fg-muted">
            {t("level", { level: bank.level })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-hq-border bg-hq-surface p-2">
          <div className="text-xs text-hq-fg-muted">{t("valueAtRisk")}</div>
          <div className="text-sm font-semibold text-hq-fg">
            {valueAtRisk.toLocaleString()}
          </div>
        </div>
        <div className="rounded border border-hq-border bg-hq-surface p-2">
          <div className="text-xs text-hq-fg-muted">{t("countAtRisk")}</div>
          <div className="text-sm font-semibold text-hq-fg">{countAtRisk}</div>
        </div>
        <div className="rounded border border-hq-border bg-hq-surface p-2">
          <div className="text-xs text-hq-fg-muted">{t("hoursUntilClear")}</div>
          <div className="text-sm font-semibold text-hq-fg">
            {hoursUntilAllMature != null ? Math.ceil(hoursUntilAllMature) : "—"}
          </div>
        </div>
      </div>

      {reasons.length > 0 ? (
        <ul className="list-inside list-disc space-y-1 text-xs text-hq-fg-muted">
          {reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {canWrite ? (
        pickerOpen ? (
          <div className="space-y-2 rounded border border-hq-border bg-hq-surface p-3">
            <label className="block space-y-1 text-sm">
              <span className="text-hq-fg-muted">{t("scheduleDrop")}</span>
              <input
                type="datetime-local"
                className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
                disabled={scheduling}
                onClick={() => setPickerOpen(false)}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={scheduling}
                onClick={async () => {
                  await onScheduleDrop(recommendation.bankId, scheduledAt);
                  setPickerOpen(false);
                }}
              >
                {scheduling ? t("schedulingDrop") : t("scheduleDrop")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={scheduling}
            onClick={() => {
              setScheduledAt(defaultDatetimeLocalValue(30));
              setPickerOpen(true);
            }}
          >
            {t("scheduleDrop")}
          </button>
        )
      ) : null}
    </div>
  );
}
