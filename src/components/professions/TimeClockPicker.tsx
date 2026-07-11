"use client";

import { useMemo, useState } from "react";

import {
  displayHourToUtcHour,
  formatCoverageHourLabel,
  utcHourToDisplayHour,
  type CoverageDisplayZone,
} from "@/lib/professions/coverage-time.shared";

type Props = {
  utcHour: number | null;
  zone: CoverageDisplayZone;
  onChange: (utcHour: number) => void;
  label: string;
};

const FACE_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function faceIndexForDisplayHour(hour24: number): number {
  return hour24 % 12;
}

function hourPosition(index: number, radius: number) {
  const angle = (index / 12) * 2 * Math.PI - Math.PI / 2;
  return {
    x: 60 + radius * Math.cos(angle),
    y: 60 + radius * Math.sin(angle),
  };
}

export function TimeClockPicker({ utcHour, zone, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const displayHour =
    utcHour === null ? null : utcHourToDisplayHour(utcHour, zone);

  const selectedIndex =
    displayHour === null ? null : faceIndexForDisplayHour(displayHour);

  const displayLabel =
    utcHour === null
      ? "—"
      : formatCoverageHourLabel(utcHour, zone);

  const handTarget = useMemo(() => {
    if (selectedIndex === null) return null;
    return hourPosition(selectedIndex, 30);
  }, [selectedIndex]);

  function selectFaceHour(faceHour: number) {
    const hour12 = faceHour === 12 ? 0 : faceHour;
    const isPm = displayHour !== null && displayHour >= 12;
    const hour24 = (hour12 % 12) + (isPm ? 12 : 0);
    onChange(displayHourToUtcHour(hour24, zone));
    setOpen(false);
  }

  function toggleAmPm() {
    if (displayHour === null) return;
    const flipped = (displayHour + 12) % 24;
    onChange(displayHourToUtcHour(flipped, zone));
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-hq-fg">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-left text-sm text-hq-fg hover:border-hq-accent"
      >
        {displayLabel}
      </button>
      {open ? (
        <div className="rounded-lg border border-hq-border bg-hq-canvas p-3">
          <svg viewBox="0 0 120 120" className="mx-auto h-40 w-40 text-hq-fg">
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="currentColor"
              className="text-hq-border"
              strokeWidth="1.5"
            />
            {FACE_HOURS.map((hour, index) => {
              const { x, y } = hourPosition(index, 44);
              const selected = selectedIndex === index;
              return (
                <g
                  key={hour}
                  onClick={() => selectFaceHour(hour)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={selected ? 11 : 9}
                    className={
                      selected ? "fill-hq-accent" : "fill-hq-surface-muted"
                    }
                  />
                  <text
                    x={x}
                    y={y + 4}
                    textAnchor="middle"
                    className={`text-[11px] ${selected ? "fill-white" : "fill-hq-fg"}`}
                    style={{ pointerEvents: "none" }}
                  >
                    {hour}
                  </text>
                </g>
              );
            })}
            {handTarget ? (
              <line
                x1="60"
                y1="60"
                x2={handTarget.x}
                y2={handTarget.y}
                stroke="currentColor"
                className="text-hq-accent"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            ) : null}
            <circle cx="60" cy="60" r="3" className="fill-hq-accent" />
          </svg>
          <div className="mt-2 flex justify-center gap-2">
            <button
              type="button"
              onClick={toggleAmPm}
              disabled={displayHour === null}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                displayHour !== null && displayHour < 12
                  ? "bg-hq-accent text-white"
                  : "bg-hq-surface-muted text-hq-fg-muted"
              }`}
            >
              AM
            </button>
            <button
              type="button"
              onClick={toggleAmPm}
              disabled={displayHour === null}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                displayHour !== null && displayHour >= 12
                  ? "bg-hq-accent text-white"
                  : "bg-hq-surface-muted text-hq-fg-muted"
              }`}
            >
              PM
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
