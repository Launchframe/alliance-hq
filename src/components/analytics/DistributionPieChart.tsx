"use client";

import {
  Cell,
  Legend,
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
    <div className="space-y-3">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
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
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {viewerKey ? <YouAreHereLegend /> : null}
    </div>
  );
}
