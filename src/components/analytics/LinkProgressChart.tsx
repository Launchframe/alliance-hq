"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { YouAreHereLegend, VIEWER_MARKER_COLOR } from "@/components/analytics/YouAreHereMarker";

type Point = {
  date: string;
  value: number;
};

type Props = {
  data: Point[];
  valueFormatter?: (value: number) => string;
  viewerLinked?: boolean;
};

export function LinkProgressChart({
  data,
  valueFormatter = (value) => `${Math.round(value * 100)}%`,
  viewerLinked,
}: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-hq-fg-muted">Snapshots will appear after the daily job runs.</p>;
  }

  const latest = data.at(-1);

  return (
    <div className="space-y-3">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 11 }} />
            <YAxis
              domain={[0, 1]}
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
            <Line
              type="monotone"
              dataKey="value"
              name="Linked"
              stroke="#58a6ff"
              strokeWidth={2}
              dot={false}
            />
            {latest ? (
              <ReferenceDot
                x={latest.date}
                y={latest.value}
                r={5}
                fill={viewerLinked ? VIEWER_MARKER_COLOR : "#58a6ff"}
                stroke="#fff"
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {viewerLinked != null ? (
        <YouAreHereLegend
          label={viewerLinked ? "You are linked" : "You are not linked yet"}
        />
      ) : null}
    </div>
  );
}
