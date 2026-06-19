import { getWeekStartMonday } from "@/lib/trains/game-time";
import type {
  MonthSchedulePagePayload,
  TrainsDashboardPayload,
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import { generateDayConfigForDate, generateWeekDayConfigs } from "@/lib/trains/templates";
import type { WeekTemplateType } from "@/lib/trains/types";
import { resolvePaintTemplateForDay } from "@/lib/trains/week-template-registry.shared";

export type TrainsDashboardSnapshot = {
  data: TrainsDashboardPayload;
  viewedWeek: WeekSchedulePagePayload;
  viewedMonth: MonthSchedulePagePayload;
};

export function upsertRecordForDate(
  records: WeekConductorRecordSummary[],
  date: string,
  patch: Partial<WeekConductorRecordSummary>,
  dayConfig?: WeekScheduleDayConfig | null,
): WeekConductorRecordSummary[] {
  const existing = records.find((r) => r.date === date);
  if (existing) {
    return records.map((r) =>
      r.date === date ? { ...r, ...patch } : r,
    );
  }

  return [
    ...records,
    {
      id: `optimistic-${date}`,
      date,
      conductorMemberId: null,
      conductorMemberName: null,
      vipMemberId: null,
      vipMemberName: null,
      conductorMechanism: dayConfig?.conductorMechanism ?? null,
      vipMechanism: dayConfig?.vipMechanism ?? null,
      lockedAt: null,
      ...patch,
    },
  ];
}

function dayConfigForDate(
  snap: TrainsDashboardSnapshot,
  date: string,
): WeekScheduleDayConfig | null {
  return (
    snap.viewedWeek.dayConfigs.find((d) => d.date === date) ??
    snap.viewedMonth.dayConfigs.find((d) => d.date === date) ??
    snap.data.dayConfigs.find((d) => d.date === date) ??
    null
  );
}

function patchRecordsInSnapshot(
  snap: TrainsDashboardSnapshot,
  date: string,
  patch: Partial<WeekConductorRecordSummary>,
): TrainsDashboardSnapshot {
  const dayConfig = dayConfigForDate(snap, date);
  const merge = (records: WeekConductorRecordSummary[]) =>
    upsertRecordForDate(records, date, patch, dayConfig);

  const weekRecords = merge(snap.data.weekRecords);
  const conductorRecord =
    snap.data.today === date
      ? (weekRecords.find((r) => r.date === date) ?? snap.data.conductorRecord)
      : snap.data.conductorRecord;

  return {
    data: { ...snap.data, weekRecords, conductorRecord },
    viewedWeek: {
      ...snap.viewedWeek,
      weekRecords: merge(snap.viewedWeek.weekRecords),
    },
    viewedMonth: {
      ...snap.viewedMonth,
      monthRecords: merge(snap.viewedMonth.monthRecords),
    },
  };
}

export function applyOptimisticConductorRoll(
  snap: TrainsDashboardSnapshot,
  date: string,
  role: "conductor" | "vip",
  member: { memberId: string; memberName: string },
): TrainsDashboardSnapshot {
  const dayConfig = dayConfigForDate(snap, date);
  if (role === "conductor") {
    return patchRecordsInSnapshot(snap, date, {
      conductorMemberId: member.memberId,
      conductorMemberName: member.memberName,
      conductorMechanism: dayConfig?.conductorMechanism ?? null,
      vipMechanism: dayConfig?.vipMechanism ?? null,
    });
  }
  return patchRecordsInSnapshot(snap, date, {
    vipMemberId: member.memberId,
    vipMemberName: member.memberName,
    vipMechanism: dayConfig?.vipMechanism ?? null,
  });
}

export function applyOptimisticConductorPick(
  snap: TrainsDashboardSnapshot,
  date: string,
  member: { memberId: string; memberName: string },
): TrainsDashboardSnapshot {
  const dayConfig = dayConfigForDate(snap, date);
  return patchRecordsInSnapshot(snap, date, {
    conductorMemberId: member.memberId,
    conductorMemberName: member.memberName,
    conductorMechanism: dayConfig?.conductorMechanism ?? null,
    vipMechanism: dayConfig?.vipMechanism ?? null,
  });
}

export function applyOptimisticLock(
  snap: TrainsDashboardSnapshot,
  date: string,
  lockedAt: string,
): TrainsDashboardSnapshot {
  return patchRecordsInSnapshot(snap, date, { lockedAt });
}

export function applyOptimisticUnlock(
  snap: TrainsDashboardSnapshot,
  date: string,
): TrainsDashboardSnapshot {
  return patchRecordsInSnapshot(snap, date, { lockedAt: null });
}

export function patchDayConfigsForDates(
  dayConfigs: WeekScheduleDayConfig[],
  dates: string[],
  templateType: WeekTemplateType,
): WeekScheduleDayConfig[] {
  const dateSet = new Set(dates);
  const byDate = new Map(dayConfigs.map((d) => [d.date, d]));

  for (const date of dates) {
    const weekStart = getWeekStartMonday(date);
    const generated = generateDayConfigForDate(templateType, date, weekStart);
    const existing = byDate.get(date);
    byDate.set(date, {
      id: existing?.id ?? `optimistic-${date}`,
      date,
      conductorMechanism: generated.conductorMechanism,
      vipMechanism: generated.vipMechanism ?? null,
      vipConfig: generated.vipConfig ?? null,
      isOverride: true,
      paintTemplate: resolvePaintTemplateForDay(templateType, date, weekStart),
    });
  }

  const seen = new Set<string>();
  const merged: WeekScheduleDayConfig[] = [];
  for (const config of dayConfigs) {
    if (dateSet.has(config.date)) {
      merged.push(byDate.get(config.date)!);
      seen.add(config.date);
    } else {
      merged.push(config);
    }
  }
  for (const date of dates) {
    if (!seen.has(date)) {
      merged.push(byDate.get(date)!);
    }
  }
  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

export function applyOptimisticPaint(
  snap: TrainsDashboardSnapshot,
  dates: string[],
  templateType: WeekTemplateType,
): TrainsDashboardSnapshot {
  return {
    data: {
      ...snap.data,
      dayConfigs: patchDayConfigsForDates(snap.data.dayConfigs, dates, templateType),
    },
    viewedWeek: {
      ...snap.viewedWeek,
      dayConfigs: patchDayConfigsForDates(
        snap.viewedWeek.dayConfigs,
        dates,
        templateType,
      ),
    },
    viewedMonth: {
      ...snap.viewedMonth,
      dayConfigs: patchDayConfigsForDates(
        snap.viewedMonth.dayConfigs,
        dates,
        templateType,
      ),
    },
  };
}

export function applyOptimisticWeekTemplate(
  snap: TrainsDashboardSnapshot,
  weekStart: string,
  templateType: WeekTemplateType,
  preserveThroughDate: string | null = null,
): TrainsDashboardSnapshot {
  const generated = generateWeekDayConfigs(templateType, weekStart).map((d) => ({
    id: `optimistic-${d.date}`,
    date: d.date,
    conductorMechanism: d.conductorMechanism,
    vipMechanism: d.vipMechanism ?? null,
    vipConfig: d.vipConfig ?? null,
    isOverride: false,
    paintTemplate: resolvePaintTemplateForDay(templateType, d.date, weekStart),
  }));

  const mergeWeekConfigs = (configs: WeekScheduleDayConfig[]) => {
    const weekEnd = generated[generated.length - 1]?.date;
    if (!weekEnd) return configs;

    const outside = configs.filter(
      (c) => c.date < weekStart || c.date > weekEnd,
    );
    const existingInWeek = configs.filter(
      (c) => c.date >= weekStart && c.date <= weekEnd,
    );
    const existingByDate = new Map(
      existingInWeek.map((config) => [config.date, config]),
    );

    const mergedInWeek = generated.map((config) => {
      if (preserveThroughDate && config.date <= preserveThroughDate) {
        return existingByDate.get(config.date) ?? config;
      }
      return config;
    });

    return [...outside, ...mergedInWeek].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  };

  return {
    data: {
      ...snap.data,
      schedule:
        snap.data.weekStart === weekStart && snap.data.schedule
          ? { ...snap.data.schedule, templateType }
          : snap.data.weekStart === weekStart
            ? {
                id: "optimistic-schedule",
                weekStart,
                templateType,
                isPivot: false,
              }
            : snap.data.schedule,
      dayConfigs:
        snap.data.weekStart === weekStart
          ? mergeWeekConfigs(snap.data.dayConfigs)
          : snap.data.dayConfigs,
    },
    viewedWeek:
      snap.viewedWeek.weekStart === weekStart
        ? {
            ...snap.viewedWeek,
            templateType,
            dayConfigs: mergeWeekConfigs(snap.viewedWeek.dayConfigs),
          }
        : snap.viewedWeek,
    viewedMonth: {
      ...snap.viewedMonth,
      dayConfigs: mergeWeekConfigs(snap.viewedMonth.dayConfigs),
    },
  };
}

export function applySnapshot(
  snap: TrainsDashboardSnapshot,
  apply: (current: TrainsDashboardSnapshot) => TrainsDashboardSnapshot,
): TrainsDashboardSnapshot {
  return apply(snap);
}
