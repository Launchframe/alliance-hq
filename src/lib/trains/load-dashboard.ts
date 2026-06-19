import {
  resolveAnchorTemplateType,
} from "@/lib/trains/day-config-resolve.server";
import { paintTemplateFromConductorConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { getAshedConnection, loadSession } from "@/lib/session";
import { sessionHasPermission, sessionIsPlatformMaintainer } from "@/lib/rbac/context";
import {
  getConductorStats,
  getWeekSchedule,
  listConductorRecordsForWeek,
  listConductorRecordsInRange,
  listDayConfigsForWeek,
  listDayConfigsInRange,
  listInventoryItems,
} from "@/lib/trains/repository";
import {
  addCalendarDays,
  monthEndFromKey,
  monthStartFromKey,
} from "@/lib/trains/game-time";
import { getPoolSummary } from "@/lib/trains/pool";
import {
  conductorMechanismPoolType,
  generateDayConfigForDate,
  generateWeekDayConfigs,
} from "@/lib/trains/templates";
import {
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/service";
import type { ConductorMechanismType, WeekTemplateType } from "@/lib/trains/types";

export type WeekConductorRecordSummary = {
  id: string;
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  vipMemberId: string | null;
  vipMemberName: string | null;
  conductorMechanism: string | null;
  vipMechanism: string | null;
  lockedAt: string | null;
};

export type WeekScheduleDayConfig = TrainsDashboardPayload["dayConfigs"][number];

export type WeekSchedulePagePayload = {
  weekStart: string;
  weekEnd: string;
  templateType: WeekTemplateType | null;
  dayConfigs: WeekScheduleDayConfig[];
  weekRecords: WeekConductorRecordSummary[];
};

export type MonthSchedulePagePayload = {
  monthKey: string;
  monthStart: string;
  monthEnd: string;
  dayConfigs: WeekScheduleDayConfig[];
  monthRecords: WeekConductorRecordSummary[];
};

function mapConductorRecord(
  row: {
    id: string;
    date: string;
    conductorMemberId: string | null;
    conductorMemberName: string | null;
    vipMemberId: string | null;
    vipMemberName: string | null;
    conductorMechanism: string | null;
    vipMechanism: string | null;
    lockedAt: Date | null;
  },
): WeekConductorRecordSummary {
  return {
    id: row.id,
    date: row.date,
    conductorMemberId: row.conductorMemberId,
    conductorMemberName: row.conductorMemberName,
    vipMemberId: row.vipMemberId,
    vipMemberName: row.vipMemberName,
    conductorMechanism: row.conductorMechanism,
    vipMechanism: row.vipMechanism,
    lockedAt: row.lockedAt?.toISOString() ?? null,
  };
}

function mapDayConfigRow(
  d: {
    id: string;
    date: string;
    conductorMechanism: string;
    conductorConfig?: unknown;
    vipMechanism: string | null;
    vipConfig: unknown;
    isOverride?: number | null;
  },
): WeekScheduleDayConfig {
  return {
    id: d.id,
    date: d.date,
    conductorMechanism: d.conductorMechanism,
    vipMechanism: d.vipMechanism,
    vipConfig: d.vipConfig,
    isOverride: d.isOverride === 1,
    paintTemplate: paintTemplateFromConductorConfig(d.conductorConfig),
  };
}

export type TrainsDashboardPayload = {
  today: string;
  weekStart: string;
  weekEnd: string;
  canManageTrains: boolean;
  canUnlockConductor: boolean;
  activeMemberCount: number;
  schedule: {
    id: string;
    weekStart: string;
    templateType: string;
    isPivot: boolean;
  } | null;
  dayConfigs: Array<{
    id: string;
    date: string;
    conductorMechanism: string;
    vipMechanism: string | null;
    vipConfig: unknown;
    isOverride: boolean;
    paintTemplate?: WeekTemplateType | null;
  }>;
  weekRecords: WeekConductorRecordSummary[];
  roster: Array<{ memberId: string; memberName: string }>;
  conductorRecord: WeekConductorRecordSummary | null;
  todayDayConfig: {
    conductorMechanism: string;
    vipMechanism: string | null;
  } | null;
  pools: Record<
    string,
    { generation: number; total: number; remaining: number; exhausted: boolean }
  >;
  conductorStats: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  } | null;
  inventoryCount: number;
};

const EMPTY_DASHBOARD_FIELDS: Pick<
  TrainsDashboardPayload,
  | "schedule"
  | "dayConfigs"
  | "weekRecords"
  | "roster"
  | "conductorRecord"
  | "todayDayConfig"
  | "pools"
  | "conductorStats"
  | "inventoryCount"
> = {
  schedule: null,
  dayConfigs: [],
  weekRecords: [],
  roster: [],
  conductorRecord: null,
  todayDayConfig: null,
  pools: {},
  conductorStats: null,
  inventoryCount: 0,
};

export async function loadTrainsDashboard(
  sessionId: string,
): Promise<TrainsDashboardPayload> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  const today = getServerCalendarDate();
  const weekStart = getWeekStartMonday(today);
  const canManageTrains = await sessionHasPermission(sessionId, "trains:write");
  const canUnlockConductor = await sessionIsPlatformMaintainer(sessionId);

  if (!allianceId) {
    return {
      today,
      weekStart,
      weekEnd: addCalendarDays(weekStart, 6),
      canManageTrains,
      canUnlockConductor,
      activeMemberCount: 0,
      ...EMPTY_DASHBOARD_FIELDS,
    };
  }

  const connection = await getAshedConnection(sessionId);
  const ashedAllianceId = await resolveAshedAllianceId(sessionId);
  const members = await loadActiveAlliancePoolMembers({
    allianceId,
    connection,
    ashedAllianceId,
  });
  const activeMemberCount = members.length;

  if (activeMemberCount === 0) {
    return {
      today,
      weekStart,
      weekEnd: addCalendarDays(weekStart, 6),
      canManageTrains,
      canUnlockConductor,
      activeMemberCount: 0,
      ...EMPTY_DASHBOARD_FIELDS,
    };
  }

  const effectiveSeason = await getEffectiveSeasonForAlliance(allianceId);
  const scheduleRow = await getWeekSchedule(
    allianceId,
    weekStart,
    effectiveSeason.seasonKey,
  );
  const weekEnd = addCalendarDays(weekStart, 6);
  const dayConfigs = scheduleRow
    ? await listDayConfigsForWeek(allianceId, weekStart, weekEnd)
    : [];

  const weekRecordRows = scheduleRow
    ? await listConductorRecordsForWeek(
        allianceId,
        weekStart,
        weekEnd,
        effectiveSeason.seasonKey,
      )
    : [];

  const mapRecord = mapConductorRecord;

  const weekRecords = weekRecordRows.map(mapRecord);
  const record = weekRecords.find((r) => r.date === today) ?? null;
  const todayDayConfig = dayConfigs.find((d) => d.date === today) ?? null;

  const poolTypes = ["r3", "r4_plus", "all_members", "event_top_x"] as const;
  const pools: TrainsDashboardPayload["pools"] = {};
  for (const poolType of poolTypes) {
    pools[poolType] = await getPoolSummary(allianceId, poolType);
  }

  let conductorStats = null;
  if (record?.conductorMemberId) {
    conductorStats = await getConductorStats(
      allianceId,
      record.conductorMemberId,
    );
  }

  const inventory = await listInventoryItems();

  return {
    today,
    weekStart,
    weekEnd,
    canManageTrains,
    canUnlockConductor,
    activeMemberCount,
    schedule: scheduleRow
      ? {
          id: scheduleRow.id,
          weekStart: scheduleRow.weekStart,
          templateType: scheduleRow.templateType,
          isPivot: scheduleRow.isPivot === 1,
        }
      : null,
    dayConfigs: dayConfigs.map(mapDayConfigRow),
    weekRecords,
    roster: members.map((m) => ({
      memberId: m.ashedMemberId,
      memberName: m.currentName,
    })),
    conductorRecord: record,
    todayDayConfig: todayDayConfig
      ? {
          conductorMechanism: todayDayConfig.conductorMechanism,
          vipMechanism: todayDayConfig.vipMechanism,
        }
      : null,
    pools,
    conductorStats,
    inventoryCount: inventory.length,
  };
}

export async function resolveAshedAllianceId(
  sessionId: string,
): Promise<string | null> {
  const session = await loadSession(sessionId);
  if (!session?.allianceTag) return null;
  const connection = await getAshedConnection(sessionId);
  if (!connection) return null;
  const alliance = await resolveAllianceByTag(connection, session.allianceTag);
  return alliance.id;
}

export async function loadWeekSchedulePage(
  sessionId: string,
  weekStartInput: string,
): Promise<WeekSchedulePagePayload | null> {
  const session = await loadSession(sessionId);
  if (!session) return null;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) return null;

  const weekStart = getWeekStartMonday(weekStartInput);
  const weekEnd = addCalendarDays(weekStart, 6);
  const effectiveSeason = await getEffectiveSeasonForAlliance(allianceId);
  const scheduleRow = await getWeekSchedule(
    allianceId,
    weekStart,
    effectiveSeason.seasonKey,
  );

  const dayConfigRows = scheduleRow
    ? await listDayConfigsForWeek(allianceId, weekStart, weekEnd)
    : [];

  const templateType: WeekTemplateType = scheduleRow
    ? (scheduleRow.templateType as WeekTemplateType)
    : await resolveAnchorTemplateType(allianceId, effectiveSeason.seasonKey);

  let dayConfigs: WeekScheduleDayConfig[];

  if (dayConfigRows.length > 0) {
    dayConfigs = dayConfigRows.map(mapDayConfigRow);
  } else {
    dayConfigs = generateWeekDayConfigs(templateType, weekStart).map((d) => ({
      id: `preview-${d.date}`,
      date: d.date,
      conductorMechanism: d.conductorMechanism,
      vipMechanism: d.vipMechanism ?? null,
      vipConfig: d.vipConfig ?? null,
      isOverride: false,
      paintTemplate: templateType,
    }));
  }

  const weekRecordRows = await listConductorRecordsForWeek(
    allianceId,
    weekStart,
    weekEnd,
    effectiveSeason.seasonKey,
  );

  return {
    weekStart,
    weekEnd,
    templateType,
    dayConfigs,
    weekRecords: weekRecordRows.map(mapConductorRecord),
  };
}

export async function loadMonthSchedulePage(
  sessionId: string,
  monthKeyInput: string,
): Promise<MonthSchedulePagePayload | null> {
  const session = await loadSession(sessionId);
  if (!session) return null;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) return null;

  const monthKey = monthKeyInput.slice(0, 7);
  const monthStart = monthStartFromKey(monthKey);
  const monthEnd = monthEndFromKey(monthKey);
  const effectiveSeason = await getEffectiveSeasonForAlliance(allianceId);
  const anchorTemplate = await resolveAnchorTemplateType(
    allianceId,
    effectiveSeason.seasonKey,
  );

  const dayConfigRows = await listDayConfigsInRange(
    allianceId,
    monthStart,
    monthEnd,
  );
  const configByDate = new Map(
    dayConfigRows.map((row) => [row.date, mapDayConfigRow(row)]),
  );

  const dayConfigs: WeekScheduleDayConfig[] = [];
  for (
    let date = monthStart;
    date <= monthEnd;
    date = addCalendarDays(date, 1)
  ) {
    const existing = configByDate.get(date);
    if (existing) {
      dayConfigs.push(existing);
      continue;
    }
    const weekStart = getWeekStartMonday(date);
    const preview = generateDayConfigForDate(
      anchorTemplate,
      date,
      weekStart,
    );
    dayConfigs.push({
      id: `preview-${date}`,
      date,
      conductorMechanism: preview.conductorMechanism,
      vipMechanism: preview.vipMechanism ?? null,
      vipConfig: preview.vipConfig ?? null,
      isOverride: false,
      paintTemplate: anchorTemplate,
    });
  }

  const recordRows = await listConductorRecordsInRange(
    allianceId,
    monthStart,
    monthEnd,
    effectiveSeason.seasonKey,
  );

  return {
    monthKey,
    monthStart,
    monthEnd,
    dayConfigs,
    monthRecords: recordRows.map(mapConductorRecord),
  };
}

export function todayPoolTypeForMechanism(
  mechanism: ConductorMechanismType | string | null | undefined,
): string | null {
  if (!mechanism) return null;
  return conductorMechanismPoolType(mechanism as ConductorMechanismType);
}
