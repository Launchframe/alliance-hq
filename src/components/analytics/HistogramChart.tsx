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

type Bucket = {
  label: string;
  count: number;
  isViewer?: boolean;
};

type Props = {
  buckets: Bucket[];
};

export function HistogramChart({ buckets }: Props) {
  if (buckets.length === 0) {
    return <p className="text-sm text-hq-fg-muted">No distribution data yet</p>;
  }

  const hasViewer = buckets.some((bucket) => bucket.isViewer);

  return (
    <div className="space-y-3">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: "#8b949e", fontSize: 11 }} />
            <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 8,
              }}
            />
            <Bar dataKey="count" name="Members">
              {buckets.map((bucket) => (
                <Cell
                  key={bucket.label}
                  fill={bucket.isViewer ? VIEWER_MARKER_COLOR : "#58a6ff"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {hasViewer ? <YouAreHereLegend /> : null}
    </div>
  );
}

export function buildVrHistogramBuckets(
  values: readonly number[],
  viewerValue: number | null,
  bucketSize = 250,
): Bucket[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const start = Math.floor(min / bucketSize) * bucketSize;
  const end = Math.ceil(max / bucketSize) * bucketSize;
  const buckets: Bucket[] = [];

  for (let floor = start; floor < end; floor += bucketSize) {
    const ceiling = floor + bucketSize;
    const count = values.filter((value) => value >= floor && value < ceiling).length;
    if (count === 0) continue;
    const isViewer =
      viewerValue != null && viewerValue >= floor && viewerValue < ceiling;
    buckets.push({
      label: `${floor}-${ceiling}`,
      count,
      isViewer,
    });
  }

  return buckets;
}
