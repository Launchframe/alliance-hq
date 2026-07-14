import {
  resolveAnchorTemplateType,
} from "@/lib/trains/day-config-resolve.server";
import { paintTemplateFromConductorConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { resolveWeekDisplayDayConfigs } from "@/lib/trains/week-schedule-day-configs.shared";
import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import type { AllianceOperatingMode } from "@/lib/native-alliance/constants";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers, loadAllianceRow } from "@/lib/members/game-roster";
import { loadPriceIsRightTicketSettings } from "@/lib/trains/train-economy-threshold.server";
import { resolveCliffPoints } from "@/lib/trains/train-price-is-right-tickets.shared";
import { loadSession } from "@/lib/session";
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
} from "@/lib/trains/templates";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";
import {
  loadTrainDiscordSettings,
  trainDiscordConfigured,
} from "@/lib/trains/train-discord-settings.server";
import { loadTrainsUserPreferences } from "@/lib/trains/trains-user-preferences.server";
import type { TrainsDisplayWeekStartDow } from "@/lib/trains/trains-display-calendar.shared";
import type { TrainsWheelSpinSpeed } from "@/lib/trains/trains-wheel-speed.shared";
import {
  loadTrainsVsDataStatus,
  type TrainsVsDataStatus,
} from "@/lib/trains/vs-data-status.server";
import { getServerCalendarDate } from "@/lib/trains/service";
import type { ConductorMechanismType, WeekTemplateType } from "@/lib/trains/types";

export type { TrainsVsDataStatus };

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
  const paintTemplate = paintTemplateFromConductorConfig(d.conductorConfig);
  return {
    id: d.id,
    date: d.date,
    conductorMechanism:
      effectiveConductorMechanism(
        d.conductorMechanism,
        paintTemplate,
        d.date,
      ) ?? d.conductorMechanism,
    vipMechanism: d.vipMechanism,
    vipConfig: d.vipConfig,
    isOverride: d.isOverride === 1,
    paintTemplate,
  };
}

export type TrainsDashboardPayload = {
  today: string;
  weekStart: string;
  weekEnd: string;
  displayWeekStartDow: TrainsDisplayWeekStartDow;
  wheelSpinSpeed: TrainsWheelSpinSpeed;
  /** Guided conductor flow (Simple Mode); defaults true. */
  simpleModeEnabled: boolean;
  trainWeekStartDow: number;
  canManageTrains: boolean;
  /** Pre-production only: train managers may clear a persisted week schedule. */
  canClearWeekSchedule: boolean;
  canUnlockConductor: boolean;
  trainDiscordAnnouncementsEnabled: boolean;
  trainDiscordConfigured: boolean;
  activeMemberCount: number;
  operatingMode: AllianceOperatingMode;
  schedule: {
    id: string;
    weekStart: string;
    templateType: string;
    isPivot: boolean;
  } | null;
  /** True when `train_week_schedules` has a row for the current train week. */
  schedulePersisted: boolean;
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
  roster: Array<{
    memberId: string;
    memberName: string;
    allianceRank?: number | null;
  }>;
  conductorRecord: WeekConductorRecordSummary | null;
  todayDayConfig: {
    conductorMechanism: string;
    vipMechanism: string | null;
  } | null;
  /**
   * Non-blocking VS / PIF score readiness for today's conductor actions.
   * Null when there is no alliance / day context to evaluate.
   */
  vsDataStatus: TrainsVsDataStatus | null;
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
  priceIsRightWeightingEnabled: boolean;
  priceIsRightCliffPoints: number | null;
};

const EMPTY_DASHBOARD_FIELDS: Pick<
  TrainsDashboardPayload,
  | "schedule"
  | "schedulePersisted"
  | "dayConfigs"
  | "weekRecords"
  | "roster"
  | "conductorRecord"
  | "todayDayConfig"
  | "vsDataStatus"
  | "pools"
  | "conductorHistory"
  | "conductorStats"
  | "inventoryCount"
  | "operatingMode"
  | "priceIsRightWeightingEnabled"
  | "priceIsRightCliffPoints"
> = {
  operatingMode: "ashed",
  schedule: null,
  schedulePersisted: false,
  dayConfigs: [],
  weekRecords: [],
  roster: [],
  conductorRecord: null,
  todayDayConfig: null,
  vsDataStatus: null,
  pools: {},
  conductorHistory: [],
  conductorStats: null,
  inventoryCount: 0,
  priceIsRightWeightingEnabled: false,
  priceIsRightCliffPoints: null,
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
  const canClearWeekSchedule =
    canManageTrains && isDevOrPreviewEnvironment();
  const canUnlockConductor = await sessionIsPlatformMaintainer(sessionId);
  const trainDiscordSettings = allianceId
    ? await loadTrainDiscordSettings(allianceId, canManageTrains)
    : {
        announcementsEnabled: false,
        guildChannelCount: 0,
        guilds: [],
        canManage: false,
      };
  const trainDiscordFields = {
    trainDiscordAnnouncementsEnabled: trainDiscordSettings.announcementsEnabled,
    trainDiscordConfigured: trainDiscordConfigured(trainDiscordSettings),
  };
  const trainWeekConfig = allianceId
    ? await loadTrainWeekConfigForAlliance(allianceId)
    : allianceTrainWeekFromRow({});
  const weekStart = getTrainWeekStart(today, trainWeekConfig);
  const preferenceFields = {
    displayWeekStartDow: userPreferences.displayWeekStartDow,
    wheelSpinSpeed: userPreferences.wheelSpinSpeed,
    simpleModeEnabled: userPreferences.simpleModeEnabled,
    trainWeekStartDow: trainWeekConfig.trainWeekStartDow,
  };

  if (!allianceId) {
    return {
      today,
      weekStart,
      weekEnd: addCalendarDays(weekStart, 6),
      ...preferenceFields,
      canManageTrains,
      canClearWeekSchedule,
      canUnlockConductor,
      ...trainDiscordFields,
      activeMemberCount: 0,
      ...EMPTY_DASHBOARD_FIELDS,
    };
  }

  const members = await loadActiveAlliancePoolMembers({ allianceId });
  const activeMemberCount = members.length;

  if (activeMemberCount === 0) {
    return {
      today,
      weekStart,
      weekEnd: addCalendarDays(weekStart, 6),
      ...preferenceFields,
      canManageTrains,
      canClearWeekSchedule,
      canUnlockConductor,
      ...trainDiscordFields,
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
  const dayConfigRows = await listDayConfigsForWeek(
    allianceId,
    weekStart,
    weekEnd,
  );
  const dashboardTemplateType: WeekTemplateType = scheduleRow
    ? (scheduleRow.templateType as WeekTemplateType)
    : await resolveAnchorTemplateType(allianceId, effectiveSeason.seasonKey);
  const dayConfigs: WeekScheduleDayConfig[] = resolveWeekDisplayDayConfigs(
    weekStart,
    dashboardTemplateType,
    dayConfigRows,
  );

  const weekRecordRows = await listConductorRecordsForWeek(
    allianceId,
    weekStart,
    weekEnd,
    effectiveSeason.seasonKey,
  );

  const mapRecord = mapConductorRecord;

  const weekRecords = weekRecordRows.map(mapRecord);
  const record = weekRecords.find((r) => r.date === today) ?? null;
  const todayDayConfig = dayConfigs.find((d) => d.date === today) ?? null;

  const poolTypes = [
    "r3",
    "r4_plus",
    "all_members",
    "event_top_x",
    "heavy_hitter",
  ] as const;
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
  const pirSettings = await loadPriceIsRightTicketSettings(allianceId);
  const vsDataStatus = todayDayConfig
    ? await loadTrainsVsDataStatus({
        allianceId,
        trainDate: today,
        conductorMechanism: todayDayConfig.conductorMechanism,
        paintTemplate: todayDayConfig.paintTemplate ?? dashboardTemplateType,
      })
    : null;

  return {
    today,
    weekStart,
    weekEnd,
    ...preferenceFields,
    canManageTrains,
    canClearWeekSchedule,
    canUnlockConductor,
    ...trainDiscordFields,
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
    schedulePersisted: scheduleRow != null,
    dayConfigs,
    weekRecords,
    roster: members.map((m) => ({
      memberId: m.ashedMemberId,
      memberName: m.currentName,
      allianceRank: m.allianceRank ?? null,
    })),
    conductorRecord: record,
    todayDayConfig: todayDayConfig
      ? {
          conductorMechanism: todayDayConfig.conductorMechanism,
          vipMechanism: todayDayConfig.vipMechanism,
        }
      : null,
    vsDataStatus,
    pools,
    conductorHistory,
    conductorStats,
    inventoryCount: inventory.length,
    priceIsRightWeightingEnabled: pirSettings.weightingEnabled,
    priceIsRightCliffPoints: pirSettings.weightingEnabled
      ? resolveCliffPoints(pirSettings)
      : null,
  };
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

  const dayConfigRows = await listDayConfigsForWeek(
    allianceId,
    weekStart,
    weekEnd,
  );

  const templateType: WeekTemplateType = scheduleRow
    ? (scheduleRow.templateType as WeekTemplateType)
    : await resolveAnchorTemplateType(allianceId, effectiveSeason.seasonKey);

  const dayConfigs: WeekScheduleDayConfig[] = resolveWeekDisplayDayConfigs(
    weekStart,
    templateType,
    dayConfigRows,
  );

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
