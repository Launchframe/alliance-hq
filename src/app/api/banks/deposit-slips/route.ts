import { NextResponse } from "next/server";

import {
  serializeDepositSlip,
  validateDepositSlipPayload,
  type DepositSlipPayload,
} from "@/lib/banks/api.shared";
import {
  buildBankManagementPayload,
  createDepositSlip,
  loadBanksWithSlips,
} from "@/lib/banks/repository.server";
import {
  requireBankAllianceContext,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { BANK_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { sessionHasPermission } from "@/lib/rbac/context";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await requireBankAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBankWrite(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as DepositSlipPayload;
  const validationError = validateDepositSlipPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const row = await createDepositSlip(allianceId, body);
    const [banks, canWrite, effectiveSeason] = await Promise.all([
      loadBanksWithSlips(allianceId),
      sessionHasPermission(sessionId, BANK_WRITE_PERMISSION),
      getEffectiveSeasonForAlliance(allianceId),
    ]);
    const dashboard = buildBankManagementPayload(banks, {
      canWrite,
      todayServerDate: getServerCalendarDate(),
      effectiveSeasonKey: effectiveSeason.seasonKey,
    });
    return NextResponse.json({
      depositSlip: serializeDepositSlip(row),
      dashboard,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message === "Bank not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
