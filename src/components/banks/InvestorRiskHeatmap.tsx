"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import type { BankWithSlips, RiskHeatmapCell } from "@/lib/banks/types.shared";

type Props = {
  bank: BankWithSlips;
  cells: RiskHeatmapCell[];
};

const HOURS_PER_ROW = 24;

function cellStyle(intensity: number): CSSProperties {
  const clamped = Math.max(0, Math.min(1, intensity));
  return {
    backgroundColor: `color-mix(in srgb, var(--hq-danger) ${Math.round(clamped * 100)}%, var(--hq-success))`,
  };
}

function formatHour(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function InvestorRiskHeatmap({ bank, cells }: Props) {
  const t = useTranslations("bankManagement");

  const rows: RiskHeatmapCell[][] = [];
  for (let i = 0; i < cells.length; i += HOURS_PER_ROW) {
    rows.push(cells.slice(i, i + HOURS_PER_ROW));
  }

  return (
    <div className="space-y-3 rounded-lg border border-hq-border bg-hq-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-hq-fg">
          {t("heatmapTitle")} —{" "}
          {t("coords", {
            server: bank.gameServerNumber,
            x: bank.coordX,
            y: bank.coordY,
          })}
        </h2>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("heatmapHint")}</p>
      </div>

      {rows.length === 0 ? null : (
        <div className="overflow-x-auto">
          <div className="inline-flex min-w-full flex-col gap-1">
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-1">
                {row.map((cell) => (
                  <div
                    key={cell.hourStartIso}
                    role="img"
                    aria-label={`${formatHour(cell.hourStartIso)}: ${cell.countAtRisk} / ${cell.valueAtRisk.toLocaleString()}`}
                    title={`${formatHour(cell.hourStartIso)}\n${t("countAtRisk")}: ${cell.countAtRisk}\n${t("valueAtRisk")}: ${cell.valueAtRisk.toLocaleString()}`}
                    className="h-5 w-5 shrink-0 rounded-sm sm:h-6 sm:w-6"
                    style={cellStyle(cell.intensity)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-hq-fg-muted">
        <span
          className="h-3 w-3 rounded-sm"
          style={{ backgroundColor: "var(--hq-success)" }}
          aria-hidden
        />
        <span>{t("countAtRisk")}: 0</span>
        <span
          className="ml-3 h-3 w-3 rounded-sm"
          style={{ backgroundColor: "var(--hq-danger)" }}
          aria-hidden
        />
        <span>{t("countAtRisk")}: max</span>
      </div>
    </div>
  );
}
