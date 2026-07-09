"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { YouAreHereLegend, VIEWER_MARKER_COLOR } from "@/components/analytics/YouAreHereMarker";

type Row = {
  key: string;
  label: string;
  value: number;
  isViewer?: boolean;
};

type Props = {
  rows: Row[];
  valueFormatter?: (value: number) => string;
};

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

export function SquadPowerBarChart({
  rows,
  valueFormatter = formatCompact,
}: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-hq-fg-muted">No squad power data yet</p>;
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: "#8b949e", fontSize: 11 }} />
            <YAxis
              tick={{ fill: "#8b949e", fontSize: 11 }}
              tickFormatter={(value) => valueFormatter(Number(value))}
            />
            <Tooltip
              contentStyle={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 8,
              }}
              formatter={(value) => valueFormatter(Number(value))}
            />
            <Bar dataKey="value" name="Total THP">
              {rows.map((row) => (
                <Cell
                  key={row.key}
                  fill={row.isViewer ? VIEWER_MARKER_COLOR : "#58a6ff"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {rows.some((row) => row.isViewer) ? <YouAreHereLegend /> : null}
    </div>
  );
}
