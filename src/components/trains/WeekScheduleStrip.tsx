"use client";

import type { TrainsDashboardPayload } from "@/lib/trains/load-dashboard";
import { mechanismNeedsWheel } from "@/lib/trains/templates";

const MECHANISM_COLORS: Record<string, string> = {
  vs_high_score: "bg-blue-500/20 text-blue-300 ring-blue-500/40",
  vs_top_10: "bg-blue-500/20 text-blue-300 ring-blue-500/40",
  r3_lottery: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  r4_sequence: "bg-purple-500/20 text-purple-300 ring-purple-500/40",
  donations_top: "bg-amber-500/20 text-amber-300 ring-amber-500/40",
  officer_pick: "bg-slate-500/20 text-slate-300 ring-slate-500/40",
  event_top_x_lottery: "bg-pink-500/20 text-pink-300 ring-pink-500/40",
  custom: "bg-slate-500/20 text-slate-300 ring-slate-500/40",
};

type Props = {
  today: string;
  dayConfigs: TrainsDashboardPayload["dayConfigs"];
  labels: Record<string, string>;
};

export function WeekScheduleStrip({ today, dayConfigs, labels }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {dayConfigs.map((day) => {
        const isToday = day.date === today;
        const color =
          MECHANISM_COLORS[day.conductorMechanism] ??
          MECHANISM_COLORS.custom;
        const weekday = new Date(`${day.date}T12:00:00-02:00`).toLocaleDateString(
          undefined,
          { weekday: "short", timeZone: "Etc/GMT+2" },
        );
        return (
          <div
            key={day.id}
            className={`min-w-[5.5rem] shrink-0 rounded-xl border px-3 py-2 ring-1 ring-inset ${
              isToday
                ? "border-[#58a6ff] bg-[#161b22]"
                : "border-[#30363d] bg-[#0d1117]"
            }`}
          >
            <div className="text-xs text-[#8b949e]">{weekday}</div>
            <div className="text-sm font-medium text-[#e6edf3]">
              {day.date.slice(5)}
            </div>
            <div
              className={`mt-2 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${color}`}
            >
              {labels[day.conductorMechanism] ?? day.conductorMechanism}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function canSpinConductor(
  mechanism: string | null | undefined,
  locked: boolean,
): boolean {
  if (locked || !mechanism) return false;
  if (mechanism === "vs_high_score" || mechanism === "donations_top") {
    return false;
  }
  return mechanismNeedsWheel(
    mechanism as Parameters<typeof mechanismNeedsWheel>[0],
  );
}

export function canSpinVip(
  mechanism: string | null | undefined,
  locked: boolean,
): boolean {
  if (locked || !mechanism) return false;
  return (
    mechanism === "donations_second" || mechanism === "event_top_x_lottery"
  );
}