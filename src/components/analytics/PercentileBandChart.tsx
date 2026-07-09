"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { analyticsTooltipProps } from "@/components/analytics/AnalyticsChartTooltip";

import { YouAreHereLegend, VIEWER_MARKER_COLOR } from "@/components/analytics/YouAreHereMarker";

export type PercentileBandPoint = {
  date: string;
  total?: number | null;
  p50?: number | null;
  p90?: number | null;
  p99?: number | null;
};

type Props = {
  data: PercentileBandPoint[];
  showTotal?: boolean;
  viewerValue?: number | null;
  viewerDate?: string | null;
  valueFormatter?: (value: number) => string;
};

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

export function PercentileBandChart({
  data,
  showTotal = false,
  viewerValue,
  viewerDate,
  valueFormatter = formatCompact,
}: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-hq-fg-muted">No data yet</p>;
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 11 }} />
            <YAxis
              tick={{ fill: "#8b949e", fontSize: 11 }}
              tickFormatter={(value) => valueFormatter(Number(value))}
            />
            <Tooltip
              {...analyticsTooltipProps}
              formatter={(value) => valueFormatter(Number(value))}
            />
            <Legend />
            {showTotal ? (
              <Line type="monotone" dataKey="total" name="Total" stroke="#58a6ff" strokeWidth={2} dot={false} />
            ) : null}
            <Line type="monotone" dataKey="p50" name="P50" stroke="#3fb950" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="p90" name="P90" stroke="#d2a8ff" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="p99" name="P99" stroke="#ffa657" strokeWidth={2} dot={false} />
            {viewerValue != null ? (
              <ReferenceLine
                y={viewerValue}
                stroke={VIEWER_MARKER_COLOR}
                strokeDasharray="4 4"
                label={{
                  value: "You",
                  fill: VIEWER_MARKER_COLOR,
                  fontSize: 11,
                  position: "insideTopRight",
                }}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {viewerValue != null ? (
        <YouAreHereLegend
          label={`You: ${valueFormatter(viewerValue)}${viewerDate ? ` (${viewerDate})` : ""}`}
        />
      ) : null}
    </div>
  );
}
