"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { YouAreHereLegend, VIEWER_MARKER_COLOR } from "@/components/analytics/YouAreHereMarker";

const COLORS = ["#58a6ff", "#3fb950", "#ffa657", "#8b949e"];

type Slice = {
  key: string;
  label: string;
  count: number;
};

type Props = {
  slices: Slice[];
  viewerKey?: string | null;
};

export function DistributionPieChart({ slices, viewerKey }: Props) {
  const data = slices.filter((slice) => slice.count > 0);
  if (data.length === 0) {
    return <p className="text-sm text-hq-fg-muted">No squad data yet</p>;
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius="75%"
              paddingAngle={2}
            >
              {data.map((slice, index) => (
                <Cell
                  key={slice.key}
                  fill={
                    viewerKey === slice.key
                      ? VIEWER_MARKER_COLOR
                      : COLORS[index % COLORS.length]
                  }
                  stroke={viewerKey === slice.key ? VIEWER_MARKER_COLOR : undefined}
                  strokeWidth={viewerKey === slice.key ? 2 : 0}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 8,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-hq-fg-muted">
        {data.map((slice, index) => (
          <li key={slice.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor:
                  viewerKey === slice.key
                    ? VIEWER_MARKER_COLOR
                    : COLORS[index % COLORS.length],
              }}
            />
            <span>{slice.label}</span>
          </li>
        ))}
      </ul>
      {viewerKey ? <YouAreHereLegend /> : null}
    </div>
  );
}
