import {
  resolveAnchorTemplateType,
} from "@/lib/trains/day-config-resolve.server";
import { paintTemplateFromConductorConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { buildWeekScheduleDayConfigs } from "@/lib/trains/week-schedule-day-configs.shared";
import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import type { AllianceOperatingMode } from "@/lib/native-alliance/constants";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers, loadAllianceRow } from "@/lib/members/game-roster";
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
  listLockedConductorHistory,
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
  allianceTrainWeekFromRow,
  getTrainWeekStart,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";
import { loadTrainsUserPreferences } from "@/lib/trains/trains-user-preferences.server";
import type { TrainsDisplayWeekStartDow } from "@/lib/trains/trains-display-calendar.shared";
import type { TrainsWheelSpinSpeed } from "@/lib/trains/trains-wheel-speed.shared";
import { getServerCalendarDate } from "@/lib/trains/service";
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
  guardianIsVip: boolean;
  lockedAt: string | null;
  substituteForMemberId: string | null;
  substituteForMemberName: string | null;
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
    guardianIsVip?: number | null;
    lockedAt: Date | null;
    substituteForMemberId?: string | null;
    substituteForMemberName?: string | null;
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
    guardianIsVip: row.guardianIsVip === 1,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    substituteForMemberId: row.substituteForMemberId ?? null,
    substituteForMemberName: row.substituteForMemberName ?? null,
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
  displayWeekStartDow: TrainsDisplayWeekStartDow;
  wheelSpinSpeed: TrainsWheelSpinSpeed;
  trainWeekStartDow: number;
  canManageTrains: boolean;
  canUnlockConductor: boolean;
  activeMemberCount: number;
  operatingMode: AllianceOperatingMode;
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
    {
      generation: number;
      total: number;
      remaining: number;
      exhausted: boolean;
      nextInSequence: { memberId: string; memberName: string } | null;
    }
  >;
  conductorHistory: WeekConductorRecordSummary[];
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
  | "conductorHistory"
  | "conductorStats"
  | "inventoryCount"
  | "operatingMode"
> = {
  operatingMode: "ashed",
  schedule: null,
  dayConfigs: [],
  weekRecords: [],
  roster: [],
  conductorRecord: null,
  todayDayConfig: null,
  pools: {},
  conductorHistory: [],
  conductorStats: null,
  inventoryCount: 0,
};

async function loadTrainWeekConfigForAlliance(
  allianceId: string,
): Promise<AllianceTrainWeekConfig> {
  const row = await loadAllianceRow(allianceId);
  return allianceTrainWeekFromRow(row ?? {});
}

export async function loadTrainsDashboard(
  sessionId: string,
): Promise<TrainsDashboardPayload> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  const userPreferences = await loadTrainsUserPreferences(session.hqUserId);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  const today = getServerCalendarDate();
  const canManageTrains = await sessionHasPermission(sessionId, "trains:write");
  const canUnlockConductor = await sessionIsPlatformMaintainer(sessionId);
  const trainWeekConfig = allianceId
    ? await loadTrainWeekConfigForAlliance(allianceId)
    : allianceTrainWeekFromRow({});
  const weekStart = getTrainWeekStart(today, trainWeekConfig);
  const preferenceFields = {
    displayWeekStartDow: userPreferences.displayWeekStartDow,
    wheelSpinSpeed: userPreferences.wheelSpinSpeed,
    trainWeekStartDow: trainWeekConfig.trainWeekStartDow,
  };

  if (!allianceId) {
    return {
      today,
      weekStart,
      weekEnd: addCalendarDays(weekStart, 6),
      ...preferenceFields,
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
      ...preferenceFields,
      canManageTrains,
      canUnlockConductor,
      activeMemberCount: 0,
      ...EMPTY_DASHBOARD_FIELDS,
    };
  }

  const effectiveSeason = await getEffectiveSeasonForAlliance(allianceId);
  const operatingMode = await getAllianceOperatingMode(allianceId);
  const scheduleRow = await getWeekSchedule(
    allianceId,
    weekStart,
    effectiveSeason.seasonKey,
  );
  const weekEnd = addCalendarDays(weekStart, 6);
  const dayConfigRows = scheduleRow
    ? await listDayConfigsForWeek(allianceId, weekStart, weekEnd)
    : [];
  const dashboardTemplateType: WeekTemplateType = scheduleRow
    ? (scheduleRow.templateType as WeekTemplateType)
    : "vs_push_week";
  const dayConfigs: WeekScheduleDayConfig[] =
    dayConfigRows.length > 0
      ? buildWeekScheduleDayConfigs(
          weekStart,
          dashboardTemplateType,
          dayConfigRows,
        )
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
  const historyRows = await listLockedConductorHistory(
    allianceId,
    effectiveSeason.seasonKey,
    30,
  );
  const conductorHistory = historyRows.map(mapRecord);

  return {
    today,
    weekStart,
    weekEnd,
    ...preferenceFields,
    canManageTrains,
    canUnlockConductor,
    activeMemberCount,
    operatingMode,
    schedule: scheduleRow
      ? {
          id: scheduleRow.id,
          weekStart: scheduleRow.weekStart,
          templateType: scheduleRow.templateType,
          isPivot: scheduleRow.isPivot === 1,
        }
      : null,
    dayConfigs,
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
    conductorHistory,
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

  const trainWeekConfig = await loadTrainWeekConfigForAlliance(allianceId);
  const weekStart = getTrainWeekStart(weekStartInput, trainWeekConfig);
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
    dayConfigs = buildWeekScheduleDayConfigs(
      weekStart,
      templateType,
      dayConfigRows,
    );
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

  const trainWeekConfig = await loadTrainWeekConfigForAlliance(allianceId);
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
    const weekStart = getTrainWeekStart(date, trainWeekConfig);
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
