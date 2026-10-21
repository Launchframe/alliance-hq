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
import {
  PERCENTILE_BAND_DISTRIBUTION_AXIS_ID,
  PERCENTILE_BAND_TOTAL_AXIS_ID,
  percentileBandAxisDomains,
} from "@/lib/analytics/percentile-band-axis.shared";

/** Chart palette — fixed across themes. Total blue is also the right-axis color. */
const TOTAL_STROKE = "#58a6ff";
const AXIS_TICK = { fill: "#8b949e", fontSize: 11 } as const;
const TOTAL_AXIS_TICK = { fill: TOTAL_STROKE, fontSize: 11 } as const;

export type PercentileBandPoint = {
  date: string;
  total?: number | null;
  p50?: number | null;
  p90?: number | null;
  p99?: number | null;
};

type Props = {
  data: PercentileBandPoint[];
  /** Alliance total uses the right axis so it does not share a scale with P50/P90/P99. */
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

  const domains = showTotal ? percentileBandAxisDomains(data, viewerValue) : null;
  const distributionAxisId = showTotal ? PERCENTILE_BAND_DISTRIBUTION_AXIS_ID : undefined;
  const formatTick = (value: number) => valueFormatter(Number(value));

  return (
    <div className="min-w-0 space-y-3">
      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={AXIS_TICK} />
            <YAxis
              yAxisId={distributionAxisId}
              orientation="left"
              width={showTotal ? 72 : undefined}
              domain={domains?.left}
              tick={AXIS_TICK}
              tickFormatter={formatTick}
            />
            {showTotal ? (
              <YAxis
                yAxisId={PERCENTILE_BAND_TOTAL_AXIS_ID}
                orientation="right"
                width={72}
                domain={domains?.right}
                tick={TOTAL_AXIS_TICK}
                axisLine={{ stroke: TOTAL_STROKE }}
                tickLine={{ stroke: TOTAL_STROKE }}
                tickFormatter={formatTick}
              />
            ) : null}
            <Tooltip
              {...analyticsTooltipProps}
              formatter={(value) => valueFormatter(Number(value))}
            />
            <Legend />
            {showTotal ? (
              <Line
                type="monotone"
                yAxisId={PERCENTILE_BAND_TOTAL_AXIS_ID}
                dataKey="total"
                name="Total"
                stroke={TOTAL_STROKE}
                strokeWidth={2}
                dot={false}
              />
            ) : null}
            <Line
              type="monotone"
              yAxisId={distributionAxisId}
              dataKey="p50"
              name="P50"
              stroke="#3fb950"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              yAxisId={distributionAxisId}
              dataKey="p90"
              name="P90"
              stroke="#d2a8ff"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              yAxisId={distributionAxisId}
              dataKey="p99"
              name="P99"
              stroke="#ffa657"
              strokeWidth={2}
              dot={false}
            />
            {viewerValue != null ? (
              <ReferenceLine
                yAxisId={distributionAxisId}
                y={viewerValue}
                ifOverflow="extendDomain"
                stroke={VIEWER_MARKER_COLOR}
                strokeDasharray="4 4"
                label={{
                  value: "You",
                  fill: VIEWER_MARKER_COLOR,
                  fontSize: 11,
                  position: showTotal ? "insideTopLeft" : "insideTopRight",
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
