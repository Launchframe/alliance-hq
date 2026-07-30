import "server-only";

import { loadAllianceSafeTimeSlot } from "@/lib/alliance/alliance-safe-time.server";
import {
  loadBattlePlanRows,
  serializeBattlePlanDashboard,
} from "@/lib/battle-plan/repository.server";
import {
  buildBankManagementPayload,
  loadAllianceBankCityListSnapshot,
  loadAllianceGameServerNumber,
  loadAllianceTag,
  loadBanksWithSlips,
} from "@/lib/banks/repository.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import {
  BANK_READ_PERMISSION,
  BANK_WRITE_PERMISSION,
  BATTLE_PLAN_READ_PERMISSION,
} from "@/lib/rbac/constants";
import { sessionHasPermission } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export async function loadBankManagementDashboard(
  sessionId: string,
  options: { nextCaptureLevel?: number | null } = {},
) {
  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return null;
  }

  const [canRead, canWrite, canReadBattlePlan] = await Promise.all([
    sessionHasPermission(sessionId, BANK_READ_PERMISSION),
    sessionHasPermission(sessionId, BANK_WRITE_PERMISSION),
    sessionHasPermission(sessionId, BATTLE_PLAN_READ_PERMISSION),
  ]);

  if (!canRead) {
    return { forbidden: true as const };
  }

  const [banks, effectiveSeason, allianceGameServerNumber, allianceTag, cityListSnapshot, allianceSafeTimeSlot, battlePlanRows] =
    await Promise.all([
      loadBanksWithSlips(allianceId),
      getEffectiveSeasonForAlliance(allianceId),
      loadAllianceGameServerNumber(allianceId),
      loadAllianceTag(allianceId),
      loadAllianceBankCityListSnapshot(allianceId),
      loadAllianceSafeTimeSlot(allianceId),
      canReadBattlePlan ? loadBattlePlanRows(allianceId) : Promise.resolve(null),
    ]);

  const battlePlan = battlePlanRows
    ? (() => {
        const serialized = serializeBattlePlanDashboard(battlePlanRows, {
          canWrite,
          todayServerDate: getServerCalendarDate(),
          allianceTag,
          allianceSafeTimeSlot,
        });
        return {
          settings: serialized.settings,
          events: serialized.events,
        };
      })()
    : null;

  return buildBankManagementPayload(banks, {
    allianceId,
    allianceTag,
    canWrite,
    todayServerDate: getServerCalendarDate(),
    effectiveSeasonKey: effectiveSeason.seasonKey,
    nextCaptureLevel: options.nextCaptureLevel ?? null,
    allianceGameServerNumber,
    bankCapturesRemainingToday:
      cityListSnapshot?.bankCapturesRemainingToday ?? null,
    bankCapturesLimitToday: cityListSnapshot?.bankCapturesLimitToday ?? null,
    bankCityListServerTime:
      cityListSnapshot?.bankCityListServerTime?.toISOString() ?? null,
    bankCityListImportedAt:
      cityListSnapshot?.bankCityListImportedAt?.toISOString() ?? null,
    allianceSafeTimeSlot,
    battlePlan,
  });
}
