import {
  loadBattlePlanRows,
  serializeBattlePlanDashboard,
} from "@/lib/battle-plan/repository.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { sessionHasPermission } from "@/lib/rbac/context";
import { BATTLE_PLAN_READ_PERMISSION, BATTLE_PLAN_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { getOrCreateSession } from "@/lib/session";

export async function loadBattlePlanDashboard(sessionId: string) {
  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return null;
  }

  const [canRead, canWrite] = await Promise.all([
    sessionHasPermission(sessionId, BATTLE_PLAN_READ_PERMISSION),
    sessionHasPermission(sessionId, BATTLE_PLAN_WRITE_PERMISSION),
  ]);

  if (!canRead) {
    return { forbidden: true as const };
  }

  const [rows, effectiveSeason] = await Promise.all([
    loadBattlePlanRows(allianceId),
    getEffectiveSeasonForAlliance(allianceId),
  ]);
  return {
    ...serializeBattlePlanDashboard(rows, {
      canWrite,
      todayServerDate: getServerCalendarDate(),
    }),
    effectiveSeasonKey: effectiveSeason.seasonKey,
  };
}
