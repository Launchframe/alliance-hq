import "server-only";

import {
  buildBankManagementPayload,
  loadAllianceGameServerNumber,
  loadBanksWithSlips,
} from "@/lib/banks/repository.server";
import type { BankManagementPayload } from "@/lib/banks/types.shared";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { BANK_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { sessionHasPermission } from "@/lib/rbac/context";
import { getServerCalendarDate } from "@/lib/trains/game-time";

/** Shared dashboard reload for bank mutation routes. */
export async function reloadBankManagementDashboard(
  allianceId: string,
  sessionId: string,
): Promise<BankManagementPayload> {
  const [banks, canWrite, effectiveSeason, allianceGameServerNumber] =
    await Promise.all([
      loadBanksWithSlips(allianceId),
      sessionHasPermission(sessionId, BANK_WRITE_PERMISSION),
      getEffectiveSeasonForAlliance(allianceId),
      loadAllianceGameServerNumber(allianceId),
    ]);

  return buildBankManagementPayload(banks, {
    canWrite,
    todayServerDate: getServerCalendarDate(),
    effectiveSeasonKey: effectiveSeason.seasonKey,
    allianceGameServerNumber,
  });
}
