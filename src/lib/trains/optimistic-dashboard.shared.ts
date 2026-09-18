import type {
  MonthSchedulePagePayload,
  TrainsDashboardPayload,
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import { weekDayConfigsForPreset } from "@/lib/trains/templates";
import type { WeekTemplateType } from "@/lib/trains/types";
import {
  conductorRuleChanged,
  type DayRules,
} from "@/lib/trains/rules/catalog.shared";
import {
  encodeLegacyConductorMechanism,
  encodeLegacyVipMechanism,
} from "@/lib/trains/rules/encode.shared";
import { shouldKeepAssignedConductorOnPaint } from "@/lib/trains/paint-rule-conductor-gate.shared";

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
      conductorRule: dayConfig?.conductorRule ?? null,
      vipRule: dayConfig?.vipRule ?? null,
      conductorMechanism: encodeLegacyConductorMechanism(
        dayConfig?.conductorRule ?? null,
      ),
      vipMechanism: encodeLegacyVipMechanism(dayConfig?.vipRule ?? null),
      guardianIsVip: false,
      lockedAt: null,
      substituteForMemberId: null,
      substituteForMemberName: null,
      eligibilityOverridden: false,
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
  options?: { guardianIsVip?: boolean },
): TrainsDashboardSnapshot {
  const dayConfig = dayConfigForDate(snap, date);
  if (role === "conductor") {
    return patchRecordsInSnapshot(snap, date, {
      conductorMemberId: member.memberId,
      conductorMemberName: member.memberName,
      conductorRule: dayConfig?.conductorRule ?? null,
      vipRule: dayConfig?.vipRule ?? null,
      eligibilityOverridden: false,
    });
  }
  return patchRecordsInSnapshot(snap, date, {
    vipMemberId: member.memberId,
    vipMemberName: member.memberName,
    vipRule: dayConfig?.vipRule ?? null,
    guardianIsVip: options?.guardianIsVip ?? false,
  });
}

export function applyOptimisticConductorPick(
  snap: TrainsDashboardSnapshot,
  date: string,
  member: { memberId: string; memberName: string },
  options?: { eligibilityOverridden?: boolean },
): TrainsDashboardSnapshot {
  const dayConfig = dayConfigForDate(snap, date);
  return patchRecordsInSnapshot(snap, date, {
    conductorMemberId: member.memberId,
    conductorMemberName: member.memberName,
    conductorRule: dayConfig?.conductorRule ?? null,
    vipRule: dayConfig?.vipRule ?? null,
    eligibilityOverridden: options?.eligibilityOverridden ?? false,
  });
}

export function applyOptimisticLock(
  snap: TrainsDashboardSnapshot,
  date: string,
  lockedAt: string,
): TrainsDashboardSnapshot {
  return patchRecordsInSnapshot(snap, date, { lockedAt, canUnlock: true });
}

export function applyOptimisticUnlock(
  snap: TrainsDashboardSnapshot,
  date: string,
): TrainsDashboardSnapshot {
  return patchRecordsInSnapshot(snap, date, { lockedAt: null, canUnlock: false });
}

export function applyOptimisticClearPendingConductor(
  snap: TrainsDashboardSnapshot,
  date: string,
): TrainsDashboardSnapshot {
  return patchRecordsInSnapshot(snap, date, {
    conductorMemberId: null,
    conductorMemberName: null,
    substituteForMemberId: null,
    substituteForMemberName: null,
    eligibilityOverridden: false,
  });
}

export function applyOptimisticConductorSwap(
  snap: TrainsDashboardSnapshot,
  dateA: string,
  dateB: string,
  lockedAt: string,
): TrainsDashboardSnapshot {
  const recordA =
    snap.viewedWeek.weekRecords.find((r) => r.date === dateA) ??
    snap.data.weekRecords.find((r) => r.date === dateA);
  const recordB =
    snap.viewedWeek.weekRecords.find((r) => r.date === dateB) ??
    snap.data.weekRecords.find((r) => r.date === dateB);

  if (!recordA?.conductorMemberId || !recordA.conductorMemberName) {
    return snap;
  }

  const targetHasConductor =
    Boolean(recordB?.conductorMemberId && recordB?.conductorMemberName);

  if (targetHasConductor) {
    let next = patchRecordsInSnapshot(snap, dateA, {
      conductorMemberId: recordB!.conductorMemberId,
      conductorMemberName: recordB!.conductorMemberName,
      substituteForMemberId: recordA.conductorMemberId,
      substituteForMemberName: recordA.conductorMemberName,
      lockedAt,
    });

    next = patchRecordsInSnapshot(next, dateB, {
      conductorMemberId: recordA.conductorMemberId,
      conductorMemberName: recordA.conductorMemberName,
      substituteForMemberId: recordB!.conductorMemberId,
      substituteForMemberName: recordB!.conductorMemberName,
      lockedAt,
    });

    return next;
  }

  let next = patchRecordsInSnapshot(snap, dateB, {
    conductorMemberId: recordA.conductorMemberId,
    conductorMemberName: recordA.conductorMemberName,
    substituteForMemberId: null,
    substituteForMemberName: null,
    lockedAt,
  });

  next = patchRecordsInSnapshot(next, dateA, {
    conductorMemberId: null,
    conductorMemberName: null,
    substituteForMemberId: null,
    substituteForMemberName: null,
    vipMemberId: null,
    vipMemberName: null,
    guardianIsVip: false,
    lockedAt: null,
  });

  return next;
}

export function patchDayConfigsForDates(
  dayConfigs: WeekScheduleDayConfig[],
  dates: string[],
  rules: DayRules,
  sourceTemplateKey: string | null = null,
): WeekScheduleDayConfig[] {
  const dateSet = new Set(dates);
  const byDate = new Map(dayConfigs.map((d) => [d.date, d]));

  for (const date of dates) {
    const existing = byDate.get(date);
    byDate.set(date, {
      id: existing?.id ?? `optimistic-${date}`,
      date,
      conductorRule: rules.conductorRule,
      vipRule: rules.vipRule,
      isOverride: true,
      sourceTemplateKey,
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

/**
 * Mirror of the server keep/clear decision in `applyPaint`. Both sides call
 * `shouldKeepAssignedConductorOnPaint`, so the optimistic UI cannot disagree
 * with what the API will do.
 */
function clearConductorPicksWhenRuleChanges(
  records: WeekConductorRecordSummary[],
  dates: string[],
  dayConfigs: WeekScheduleDayConfig[],
  nextRules: DayRules,
  roster: Array<{ memberId: string; allianceRank?: number | null }> = [],
): WeekConductorRecordSummary[] {
  const dateSet = new Set(dates);
  const rosterById = new Map(roster.map((row) => [row.memberId, row]));
  return records.map((record) => {
    if (
      !dateSet.has(record.date) ||
      (!record.conductorMemberId && !record.vipMemberId)
    ) {
      return record;
    }

    const previousDay = dayConfigs.find((day) => day.date === record.date);
    if (!previousDay) return record;

    if (
      !conductorRuleChanged(
        previousDay.conductorRule,
        nextRules.conductorRule,
      )
    ) {
      return record;
    }

    const rosterRow = record.conductorMemberId
      ? rosterById.get(record.conductorMemberId)
      : undefined;
    const keep = shouldKeepAssignedConductorOnPaint({
      ruleChanged: true,
      memberId: record.conductorMemberId,
      onRoster: rosterRow != null,
      allianceRank: rosterRow?.allianceRank,
      nextRule: nextRules.conductorRule,
    });
    if (keep) {
      return {
        ...record,
        conductorRule: nextRules.conductorRule,
        vipRule: nextRules.vipRule,
      };
    }
    if (record.lockedAt) {
      return record;
    }

    return {
      ...record,
      conductorMemberId: null,
      conductorMemberName: null,
      substituteForMemberId: null,
      substituteForMemberName: null,
      vipMemberId: null,
      vipMemberName: null,
      conductorRule: nextRules.conductorRule,
      vipRule: nextRules.vipRule,
    };
  });
}

export function applyOptimisticPaint(
  snap: TrainsDashboardSnapshot,
  dates: string[],
  rules: DayRules,
  options?: {
    /** Preset to stamp on the week schedule, when this paint sets one. */
    updateWeekTemplate?: WeekTemplateType | null;
    sourceTemplateKey?: string | null;
  },
): TrainsDashboardSnapshot {
  const sourceTemplateKey = options?.sourceTemplateKey ?? null;
  const clearRecords = (
    records: WeekConductorRecordSummary[],
    dayConfigs: WeekScheduleDayConfig[],
  ) =>
    clearConductorPicksWhenRuleChanges(
      records,
      dates,
      dayConfigs,
      rules,
      snap.data.roster ?? [],
    );

  let next: TrainsDashboardSnapshot = {
    data: {
      ...snap.data,
      dayConfigs: patchDayConfigsForDates(
        snap.data.dayConfigs,
        dates,
        rules,
        sourceTemplateKey,
      ),
      weekRecords: clearRecords(snap.data.weekRecords, snap.data.dayConfigs),
      conductorRecord:
        dates.includes(snap.data.today) &&
        snap.data.conductorRecord &&
        (snap.data.conductorRecord.conductorMemberId ||
          snap.data.conductorRecord.vipMemberId)
          ? clearRecords(
              [snap.data.conductorRecord],
              snap.data.dayConfigs,
            )[0] ?? snap.data.conductorRecord
          : snap.data.conductorRecord,
    },
    viewedWeek: {
      ...snap.viewedWeek,
      dayConfigs: patchDayConfigsForDates(
        snap.viewedWeek.dayConfigs,
        dates,
        rules,
        sourceTemplateKey,
      ),
      weekRecords: clearRecords(
        snap.viewedWeek.weekRecords,
        snap.viewedWeek.dayConfigs,
      ),
    },
    viewedMonth: {
      ...snap.viewedMonth,
      dayConfigs: patchDayConfigsForDates(
        snap.viewedMonth.dayConfigs,
        dates,
        rules,
        sourceTemplateKey,
      ),
      monthRecords: clearRecords(
        snap.viewedMonth.monthRecords,
        snap.viewedMonth.dayConfigs,
      ),
    },
  };

  const templateType = options?.updateWeekTemplate;
  if (!templateType) {
    return next;
  }

  const touchesViewedWeek = dates.some(
    (date) =>
      date >= next.viewedWeek.weekStart && date <= next.viewedWeek.weekEnd,
  );
  if (touchesViewedWeek) {
    next = {
      ...next,
      viewedWeek: { ...next.viewedWeek, templateType },
    };
  }

  if (
    dates.some(
      (date) => date >= next.data.weekStart && date <= next.data.weekEnd,
    )
  ) {
    next = {
      ...next,
      data: {
        ...next.data,
        schedulePersisted: true,
        schedule: next.data.schedule
          ? { ...next.data.schedule, templateType }
          : {
              id: "optimistic-schedule",
              weekStart: next.data.weekStart,
              templateType,
              isPivot: false,
            },
      },
    };
  }

  return next;
}

export function applyOptimisticWeekTemplate(
  snap: TrainsDashboardSnapshot,
  weekStart: string,
  templateType: WeekTemplateType,
  preserveThroughDate: string | null = null,
): TrainsDashboardSnapshot {
  const generated = weekDayConfigsForPreset(templateType, weekStart).map(
    (day) => ({
      id: `optimistic-${day.date}`,
      date: day.date,
      conductorRule: day.conductorRule,
      vipRule: day.vipRule,
      isOverride: false,
      sourceTemplateKey: templateType,
    }),
  );

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
