import "server-only";

import {
  buildBankManagementPayload,
  loadBanksWithSlips,
} from "@/lib/banks/repository.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import {
  BANK_READ_PERMISSION,
  BANK_WRITE_PERMISSION,
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

  const [canRead, canWrite] = await Promise.all([
    sessionHasPermission(sessionId, BANK_READ_PERMISSION),
    sessionHasPermission(sessionId, BANK_WRITE_PERMISSION),
  ]);

  if (!canRead) {
    return { forbidden: true as const };
  }

  const [banks, effectiveSeason] = await Promise.all([
    loadBanksWithSlips(allianceId),
    getEffectiveSeasonForAlliance(allianceId),
  ]);

  return buildBankManagementPayload(banks, {
    canWrite,
    todayServerDate: getServerCalendarDate(),
    effectiveSeasonKey: effectiveSeason.seasonKey,
    nextCaptureLevel: options.nextCaptureLevel ?? null,
  });
}
