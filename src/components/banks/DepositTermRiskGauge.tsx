"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { DepositTermRiskGauge as GaugeModel } from "@/lib/banks/risk-profile.shared";
import { riskIntensityColor } from "@/lib/banks/risk-color.shared";

type Size = "sm" | "md";

const SIZE_PX: Record<Size, number> = { sm: 36, md: 64 };
const STROKE: Record<Size, number> = { sm: 3, md: 4 };

type Props = {
  gauge: GaugeModel;
  size?: Size;
};

function bandLabelKey(
  band: GaugeModel["band"],
): `bandUnknown` | `bandRiskFree` | `bandLow` | `bandMaterial` | `bandImminent` | `bandDropPreempt` {
  switch (band) {
    case "unknown":
      return "bandUnknown";
    case "risk-free":
      return "bandRiskFree";
    case "low":
      return "bandLow";
    case "material":
      return "bandMaterial";
    case "imminent":
      return "bandImminent";
    default:
      return "bandUnknown";
  }
}

export function DepositTermRiskGauge({ gauge, size = "md" }: Props) {
  const t = useTranslations("bankManagement.riskProfile");
  const px = SIZE_PX[size];
  const stroke = STROKE[size];
  const radius = (px - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset =
    gauge.band === "unknown"
      ? circumference
      : circumference * (1 - gauge.fillPercent / 100);

  const ariaLabel = useMemo(
    () =>
      `${t("gaugeTermLabel", { days: gauge.termDays })} — ${t(bandLabelKey(gauge.band))}`,
    [gauge.band, gauge.termDays, t],
  );

  const ringColor =
    gauge.band === "unknown"
      ? "var(--hq-fg-muted)"
      : riskIntensityColor(gauge.intensity);

  return (
    <div
      className="flex flex-col items-center gap-1"
      title={ariaLabel}
      aria-label={ariaLabel}
    >
      <div className="relative" style={{ width: px, height: px }}>
        <svg width={px} height={px} className="-rotate-90" aria-hidden>
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            stroke="var(--hq-border)"
            strokeWidth={stroke}
          />
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={
              gauge.band === "unknown"
                ? { strokeDasharray: `${circumference * 0.25} ${circumference * 0.25}` }
                : undefined
            }
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center font-mono text-hq-fg ${
            size === "sm" ? "text-[10px]" : "text-xs"
          }`}
        >
          {gauge.termDays}d
        </span>
      </div>
    </div>
  );
}

type GaugesProps = {
  gauges: GaugeModel[];
  size?: Size;
};

export function DepositTermRiskGauges({ gauges, size = "md" }: GaugesProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="deposit-term-risk-gauges">
      {gauges.map((gauge) => (
        <DepositTermRiskGauge key={gauge.termDays} gauge={gauge} size={size} />
      ))}
    </div>
  );
}
