import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { getAshedConnection, loadSession } from "@/lib/session";
import { sessionHasPermission } from "@/lib/rbac/context";
import {
  getConductorRecord,
  getConductorStats,
  listInventoryItems,
} from "@/lib/trains/repository";
import {
  getOrCreateWeekSchedule,
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
      schedule: null,
      dayConfigs: [],
      conductorRecord: null,
      todayDayConfig: null,
      pools: {},
      conductorStats: null,
      inventoryCount: 0,
    };
  }

  const { schedule, dayConfigs } = await getOrCreateWeekSchedule(
    allianceId,
    weekStart,
  );

  const record = await getConductorRecord(allianceId, today);
  const todayDayConfig =
    dayConfigs.find((d) => d.date === today) ?? null;

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
    schedule: {
      id: schedule.id,
      weekStart: schedule.weekStart,
      templateType: schedule.templateType,
      isPivot: schedule.isPivot === 1,
    },
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
