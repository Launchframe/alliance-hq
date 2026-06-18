import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { getAshedConnection, loadSession } from "@/lib/session";
import { sessionHasPermission } from "@/lib/rbac/context";
import {
  getConductorRecord,
  getConductorStats,
  getWeekSchedule,
  listDayConfigsForWeek,
  listInventoryItems,
} from "@/lib/trains/repository";
import { addCalendarDays } from "@/lib/trains/game-time";
import {
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/service";
import { getPoolSummary } from "@/lib/trains/pool";
import { conductorMechanismPoolType } from "@/lib/trains/templates";
import type { ConductorMechanismType } from "@/lib/trains/types";

export type TrainsDashboardPayload = {
  today: string;
  weekStart: string;
  canManageTrains: boolean;
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
  }>;
  conductorRecord: {
    id: string;
    date: string;
    conductorMemberId: string | null;
    conductorMemberName: string | null;
    vipMemberId: string | null;
    vipMemberName: string | null;
    conductorMechanism: string | null;
    vipMechanism: string | null;
    lockedAt: string | null;
  } | null;
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
  | "conductorRecord"
  | "todayDayConfig"
  | "pools"
  | "conductorStats"
  | "inventoryCount"
> = {
  schedule: null,
  dayConfigs: [],
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

  if (!allianceId) {
    return {
      today,
      weekStart,
      canManageTrains,
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
      canManageTrains,
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

  const record = await getConductorRecord(
    allianceId,
    today,
    effectiveSeason.seasonKey,
  );
  const todayDayConfig = dayConfigs.find((d) => d.date === today) ?? null;

  const poolTypes = ["r3", "r4_plus", "all_members"] as const;
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
    canManageTrains,
    activeMemberCount,
    schedule: scheduleRow
      ? {
          id: scheduleRow.id,
          weekStart: scheduleRow.weekStart,
          templateType: scheduleRow.templateType,
          isPivot: scheduleRow.isPivot === 1,
        }
      : null,
    dayConfigs: dayConfigs.map((d) => ({
      id: d.id,
      date: d.date,
      conductorMechanism: d.conductorMechanism,
      vipMechanism: d.vipMechanism,
      vipConfig: d.vipConfig,
    })),
    conductorRecord: record
      ? {
          id: record.id,
          date: record.date,
          conductorMemberId: record.conductorMemberId,
          conductorMemberName: record.conductorMemberName,
          vipMemberId: record.vipMemberId,
          vipMemberName: record.vipMemberName,
          conductorMechanism: record.conductorMechanism,
          vipMechanism: record.vipMechanism,
          lockedAt: record.lockedAt?.toISOString() ?? null,
        }
      : null,
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

export function todayPoolTypeForMechanism(
  mechanism: ConductorMechanismType | string | null | undefined,
): string | null {
  if (!mechanism) return null;
  return conductorMechanismPoolType(mechanism as ConductorMechanismType);
}
