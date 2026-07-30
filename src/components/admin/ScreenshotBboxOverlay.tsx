"use client";

import type { ScreenshotOcrBboxOverlay } from "@/lib/ocr/screenshot-ocr-geometry.shared";

const OVERLAY_COLORS = [
  "#58a6ff",
  "#3fb950",
  "#d29922",
  "#f85149",
  "#bc8cff",
  "#ffa657",
  "#79c0ff",
  "#ff7b72",
  "#a5d6ff",
];

function overlayColor(index: number): string {
  if (index === 0) return "#8b949e";
  return OVERLAY_COLORS[(index - 1) % OVERLAY_COLORS.length] ?? "#58a6ff";
}

function formatOverlayLegend(overlay: ScreenshotOcrBboxOverlay): string {
  const value =
    overlay.parsedValue != null
      ? String(overlay.parsedValue)
      : overlay.parsedText?.trim() || "—";
  return `${overlay.fieldKey} · ${value}`;
}

type Props = {
  imageUrl: string;
  width: number;
  height: number;
  overlays: ScreenshotOcrBboxOverlay[];
  title?: string;
  className?: string;
};

export function ScreenshotBboxOverlay({
  imageUrl,
  width,
  height,
  overlays,
  title,
  className,
}: Props) {
  const sorted = [...overlays].sort((a, b) => a.index - b.index);

  return (
    <div className={className}>
      {title ? (
        <h3 className="mb-2 text-sm font-medium text-hq-fg">{title}</h3>
      ) : null}
      <div
        className="relative overflow-hidden rounded-lg border border-hq-border bg-hq-canvas"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={title ?? "Screenshot preview"}
          className="absolute inset-0 h-full w-full object-contain"
        />
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {sorted.map((overlay) => {
            const color = overlayColor(overlay.index);
            const { x0, y0, x1, y1 } = overlay.rect;
            const boxWidth = Math.max(1, x1 - x0);
            const boxHeight = Math.max(1, y1 - y0);
            return (
              <g key={`${overlay.index}-${overlay.fieldKey}`}>
                <rect
                  x={x0}
                  y={y0}
                  width={boxWidth}
                  height={boxHeight}
                  fill={`${color}22`}
                  stroke={color}
                  strokeWidth={Math.max(1, width / 400)}
                />
                <text
                  x={x0 + 4}
                  y={Math.max(y0 + 14, 14)}
                  fill={color}
                  fontSize={Math.max(10, width / 80)}
                  fontWeight="700"
                >
                  {overlay.index}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {sorted.length > 0 ? (
        <ul className="mt-3 grid gap-1.5 text-xs text-hq-fg-muted sm:grid-cols-2">
          {sorted.map((overlay) => (
            <li key={`legend-${overlay.index}-${overlay.fieldKey}`} className="flex min-w-0 items-start gap-2">
              <span
                className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold"
                style={{
                  borderColor: overlayColor(overlay.index),
                  color: overlayColor(overlay.index),
                }}
              >
                {overlay.index}
              </span>
              <span className="min-w-0 break-words">{formatOverlayLegend(overlay)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
