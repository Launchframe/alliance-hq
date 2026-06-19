"use client";

import type { TrainsDashboardPayload } from "@/lib/trains/load-dashboard";
import { mechanismNeedsWheel } from "@/lib/trains/templates";

const MECHANISM_STYLES: Record<string, string> = {
  vs_high_score: "border-blue-500 bg-blue-500/15 text-blue-200",
  vs_top_10: "border-blue-500 bg-blue-500/15 text-blue-200",
  r3_lottery: "border-emerald-500 bg-emerald-500/15 text-emerald-200",
  r4_sequence: "border-purple-500 bg-purple-500/15 text-purple-200",
  donations_top: "border-amber-500 bg-amber-500/15 text-amber-200",
  officer_pick: "border-slate-400 bg-slate-500/15 text-slate-200",
  event_top_x_lottery: "border-pink-500 bg-pink-500/15 text-pink-200",
  custom: "border-slate-500 bg-slate-500/15 text-slate-200",
};

type Props = {
  today: string;
  dayConfigs: TrainsDashboardPayload["dayConfigs"];
  conductorLabels: Record<string, string>;
  vipLabels: Record<string, string>;
};

export function WeekScheduleStrip({
  today,
  dayConfigs,
  conductorLabels,
  vipLabels,
}: Props) {
  if (dayConfigs.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {dayConfigs.map((day) => {
        const isToday = day.date === today;
        const style =
          MECHANISM_STYLES[day.conductorMechanism] ??
          MECHANISM_STYLES.custom;
        const weekday = new Date(`${day.date}T12:00:00-02:00`).toLocaleDateString(
          undefined,
          { weekday: "short", timeZone: "Etc/GMT+2" },
        );
        const vipLabel =
          day.vipMechanism && day.vipMechanism !== "none"
            ? (vipLabels[day.vipMechanism] ?? day.vipMechanism)
            : null;

        return (
          <div
            key={day.id}
            className={`flex aspect-square min-w-0 flex-col justify-between rounded-lg border-2 p-1.5 ${
              isToday ? "ring-2 ring-[#58a6ff] ring-offset-1 ring-offset-[#0d1117]" : ""
            } ${style}`}
          >
            <div className="min-w-0">
              <div className="truncate text-[10px] font-medium uppercase tracking-wide opacity-80">
                {weekday}
              </div>
              <div className="text-xs font-semibold tabular-nums">
                {day.date.slice(5)}
              </div>
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="truncate text-[10px] font-bold uppercase leading-tight">
                {conductorLabels[day.conductorMechanism] ?? day.conductorMechanism}
              </div>
              {vipLabel ? (
                <div className="truncate text-[9px] font-medium uppercase leading-tight opacity-90">
                  {vipLabel}
                </div>
              ) : null}
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
