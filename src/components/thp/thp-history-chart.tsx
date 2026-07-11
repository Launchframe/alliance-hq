"use client";

import type { MyThpEvent } from "@/lib/thp/my-thp.shared";
import { thpChartYDomain } from "@/lib/thp/my-thp-chart.shared";

type Props = {
  events: MyThpEvent[];
  className?: string;
};

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return String(value);
}

export function ThpHistoryChart({ events, className }: Props) {
  if (events.length < 2) {
    return null;
  }

  const innerW = CHART_WIDTH - PAD.left - PAD.right;
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const { min: minThp, max: maxThp, span: thpSpan } = thpChartYDomain(
    events.map((event) => event.total),
  );

  const points = events.map((event, index) => {
    const x =
      PAD.left +
      (events.length === 1 ? innerW / 2 : (index / (events.length - 1)) * innerW);
    const y = PAD.top + innerH - ((event.total - minThp) / thpSpan) * innerH;
    return { x, y, event };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className={className ?? "h-auto w-full max-w-full"}
      role="img"
      aria-label="THP over time"
      data-testid="my-thp-history-chart"
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
      <text x={PAD.left - 8} y={PAD.top + 4} fill="#8b949e" fontSize={10} textAnchor="end">
        {formatAxisValue(maxThp)}
      </text>
      <text
        x={PAD.left - 8}
        y={PAD.top + innerH}
        fill="#8b949e"
        fontSize={10}
        textAnchor="end"
        dominantBaseline="hanging"
      >
        {formatAxisValue(minThp)}
      </text>
      <polyline
        fill="none"
        stroke="#58a6ff"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={polyline}
      />
      {points.map((point, index) => (
        <g key={`${point.event.createdAt}-${index}`}>
          <circle cx={point.x} cy={point.y} r={4} fill="#58a6ff" />
          <text
            x={point.x}
            y={PAD.top + innerH + 16}
            fill="#8b949e"
            fontSize={10}
            textAnchor="middle"
          >
            {formatShortDate(point.event.createdAt)}
          </text>
        </g>
      ))}
    </svg>
  );
}
