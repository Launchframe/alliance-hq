"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  formatPriceIsRightVsScore,
  samplePriceIsRightTicketCurve,
  samplePriceIsRightUniformCurve,
  type PriceIsRightChartPoint,
  type PriceIsRightTicketSettings,
} from "@/lib/trains/train-price-is-right-tickets.shared";
import {
  PRICE_IS_RIGHT_MIN_VS_SCORE,
  type TrainEconomyThresholdSettings,
} from "@/lib/trains/train-economy-threshold.shared";

type YMode = "tickets" | "probability";

type Props = {
  settings: PriceIsRightTicketSettings;
  /** Required for non-raffle (uniform band) curve preview. */
  economy?: TrainEconomyThresholdSettings | null;
  memberPoints?: PriceIsRightChartPoint[];
  className?: string;
  caption?: string;
  "data-testid"?: string;
};

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PAD = { top: 20, right: 20, bottom: 32, left: 56 };

function formatProbability(value: number): string {
  if (value >= 0.01) return `${(value * 100).toFixed(1)}%`;
  if (value > 0) return `${(value * 100).toFixed(2)}%`;
  return "0%";
}

function formatYValue(value: number, mode: YMode): string {
  return mode === "tickets" ? String(Math.round(value)) : formatProbability(value);
}

export function PriceIsRightTicketDistributionChart({
  settings,
  economy = null,
  memberPoints = [],
  className,
  caption,
  "data-testid": dataTestId,
}: Props) {
  const t = useTranslations("trains.priceIsRight.chart");
  const weighted = settings.weightingEnabled;
  const [yMode, setYMode] = useState<YMode>(weighted ? "tickets" : "probability");
  const [hovered, setHovered] = useState<PriceIsRightChartPoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  const theoreticalPoints = useMemo(() => {
    if (weighted) return samplePriceIsRightTicketCurve(settings, 48);
    if (!economy) return [];
    return samplePriceIsRightUniformCurve(economy, 48);
  }, [economy, settings, weighted]);

  const allPoints = useMemo(
    () => [...theoreticalPoints, ...memberPoints],
    [memberPoints, theoreticalPoints],
  );

  const effectiveYMode: YMode = weighted ? yMode : "probability";

  if (theoreticalPoints.length < 2) {
    return caption ? (
      <div className={className ?? "relative w-full"} data-testid={dataTestId}>
        <p className="text-xs text-hq-fg-muted">{caption}</p>
      </div>
    ) : null;
  }

  const innerW = CHART_WIDTH - PAD.left - PAD.right;
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const minX = PRICE_IS_RIGHT_MIN_VS_SCORE;
  const maxX = Math.max(...allPoints.map((point) => point.score), minX + 1);
  const xSpan = Math.max(maxX - minX, 1);

  const yValues = allPoints.map((point) =>
    effectiveYMode === "tickets" ? point.tickets : point.winProbability,
  );
  const minY = 0;
  const maxY = Math.max(...yValues, effectiveYMode === "tickets" ? 1 : 0.0001);
  const ySpan = Math.max(
    maxY - minY,
    effectiveYMode === "tickets" ? 1 : 0.0001,
  );

  const mapX = (score: number) =>
    PAD.left + ((score - minX) / xSpan) * innerW;
  const mapY = (value: number) =>
    PAD.top + innerH - ((value - minY) / ySpan) * innerH;

  const curvePolyline = theoreticalPoints
    .map((point) => {
      const yValue =
        effectiveYMode === "tickets" ? point.tickets : point.winProbability;
      return `${mapX(point.score)},${mapY(yValue)}`;
    })
    .join(" ");

  const xTicks = [
    minX,
    minX + xSpan * 0.25,
    minX + xSpan * 0.5,
    minX + xSpan * 0.75,
    maxX,
  ];

  const handlePointHover = (
    point: PriceIsRightChartPoint,
    event: React.MouseEvent<SVGCircleElement>,
  ) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    setHovered(point);
    setTooltipPos({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  return (
    <div className={className ?? "relative w-full"} data-testid={dataTestId}>
      {weighted ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div
            className="inline-flex rounded-lg border border-hq-border bg-hq-canvas p-0.5"
            role="group"
            aria-label={t("yToggleLabel")}
          >
            <button
              type="button"
              onClick={() => setYMode("tickets")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                yMode === "tickets"
                  ? "bg-cyan-500/20 text-cyan-200"
                  : "text-hq-fg-muted hover:text-hq-fg"
              }`}
            >
              {t("yTickets")}
            </button>
            <button
              type="button"
              onClick={() => setYMode("probability")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                yMode === "probability"
                  ? "bg-cyan-500/20 text-cyan-200"
                  : "text-hq-fg-muted hover:text-hq-fg"
              }`}
            >
              {t("yProbability")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full max-w-full"
          role="img"
          aria-label={t("ariaLabel")}
          onMouseLeave={() => {
            setHovered(null);
            setTooltipPos(null);
          }}
        >
          <line
            x1={PAD.left}
            y1={PAD.top + innerH}
            x2={PAD.left + innerW}
            y2={PAD.top + innerH}
            stroke="#30363d"
            strokeWidth={1}
          />
          <line
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={PAD.top + innerH}
            stroke="#30363d"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={PAD.top + 4}
            fill="#8b949e"
            fontSize={10}
            textAnchor="end"
          >
            {formatYValue(maxY, effectiveYMode)}
          </text>
          <text
            x={PAD.left - 8}
            y={PAD.top + innerH}
            fill="#8b949e"
            fontSize={10}
            textAnchor="end"
            dominantBaseline="hanging"
          >
            {formatYValue(minY, effectiveYMode)}
          </text>
          {xTicks.map((tick) => (
            <text
              key={tick}
              x={mapX(tick)}
              y={PAD.top + innerH + 16}
              fill="#8b949e"
              fontSize={10}
              textAnchor="middle"
            >
              {formatPriceIsRightVsScore(tick)}
            </text>
          ))}
          <polyline
            fill="none"
            stroke="#22d3ee"
            strokeOpacity={0.55}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={curvePolyline}
          />
          {memberPoints.map((point) => {
            const yValue =
              effectiveYMode === "tickets"
                ? point.tickets
                : point.winProbability;
            const fill = point.isViewer
              ? "#fbbf24"
              : point.isTakedownOverride
                ? "#a78bfa"
                : "#58a6ff";
            return (
              <circle
                key={`${point.memberId ?? "member"}-${point.score}`}
                cx={mapX(point.score)}
                cy={mapY(yValue)}
                r={point.isViewer ? 5 : 4}
                fill={fill}
                stroke="#0d1117"
                strokeWidth={1}
                className="cursor-pointer"
                onMouseEnter={(event) => handlePointHover(point, event)}
                onMouseMove={(event) => handlePointHover(point, event)}
              />
            );
          })}
        </svg>

        {hovered && tooltipPos ? (
          <div
            className="pointer-events-none absolute z-10 max-w-[16rem] rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-xs text-hq-fg shadow-lg"
            style={{
              left: Math.min(tooltipPos.x + 12, CHART_WIDTH - 180),
              top: Math.max(tooltipPos.y - 48, 8),
            }}
          >
            {hovered.memberName ? (
              <p className="font-medium text-hq-fg">{hovered.memberName}</p>
            ) : null}
            <p className="text-hq-fg-muted">
              {t("tooltip", {
                name: hovered.memberName ?? t("theoreticalPoint"),
                score: formatPriceIsRightVsScore(hovered.score),
                tickets: hovered.tickets,
                probability: formatProbability(hovered.winProbability),
              })}
            </p>
          </div>
        ) : null}
      </div>

      {caption ? (
        <p className="mt-2 text-xs text-hq-fg-muted">{caption}</p>
      ) : null}
    </div>
  );
}
