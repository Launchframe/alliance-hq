"use client";

import { useTranslations } from "next-intl";

type Props = {
  recommendation: import("@/lib/banks/types.shared").RecommendedDropMetrics | null;
  canWrite: boolean;
  scheduling: boolean;
  onRequestScheduleDrop: (bankId: string) => void;
};

export function RecommendedDropCard({
  recommendation,
  canWrite,
  scheduling,
  onRequestScheduleDrop,
}: Props) {
  const t = useTranslations("bankManagement");

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
    <div className="min-w-0 space-y-3 rounded-lg border border-hq-accent/40 bg-hq-accent/5 p-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-hq-fg">
          {t("recommendedTitle")}
        </h2>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <span className="break-words font-medium text-hq-fg">
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

      <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
        <div className="min-w-0 rounded border border-hq-border bg-hq-surface p-2">
          <div className="text-xs text-hq-fg-muted">{t("valueAtRisk")}</div>
          <div className="text-sm font-semibold text-hq-fg">
            {valueAtRisk.toLocaleString()}
          </div>
        </div>
        <div className="min-w-0 rounded border border-hq-border bg-hq-surface p-2">
          <div className="text-xs text-hq-fg-muted">{t("countAtRisk")}</div>
          <div className="text-sm font-semibold text-hq-fg">{countAtRisk}</div>
        </div>
        <div className="min-w-0 rounded border border-hq-border bg-hq-surface p-2">
          <div className="text-xs text-hq-fg-muted">{t("hoursUntilClear")}</div>
          <div className="text-sm font-semibold text-hq-fg">
            {hoursUntilAllMature != null ? Math.ceil(hoursUntilAllMature) : "—"}
          </div>
        </div>
      </div>

      {reasons.length > 0 ? (
        <ul className="list-inside list-disc space-y-1 break-words text-xs text-hq-fg-muted">
          {reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {canWrite ? (
        <button
          type="button"
          className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={scheduling}
          onClick={() => onRequestScheduleDrop(recommendation.bankId)}
        >
          {scheduling ? t("schedulingDrop") : t("scheduleDrop")}
        </button>
      ) : null}
    </div>
  );
}
