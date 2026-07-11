import { NextResponse } from "next/server";

import {
  serializeDepositSlip,
  validateDepositSlipPayload,
  type DepositSlipPayload,
} from "@/lib/banks/api.shared";
import {
  buildBankManagementPayload,
  deleteDepositSlip,
  loadBanksWithSlips,
  updateDepositSlip,
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

type RouteContext = { params: Promise<{ id: string }> };

async function reloadDashboard(allianceId: string, sessionId: string) {
  const [banks, canWrite, effectiveSeason] = await Promise.all([
    loadBanksWithSlips(allianceId),
    sessionHasPermission(sessionId, BANK_WRITE_PERMISSION),
    getEffectiveSeasonForAlliance(allianceId),
  ]);
  return buildBankManagementPayload(banks, {
    canWrite,
    todayServerDate: getServerCalendarDate(),
    effectiveSeasonKey: effectiveSeason.seasonKey,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const { sessionId, allianceId } = auth;
  const denied = await requireBankWrite(sessionId);
  if (denied) return denied;

  const { id } = await context.params;
  const body = (await request.json()) as DepositSlipPayload;
  const validationError = validateDepositSlipPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const row = await updateDepositSlip(allianceId, id, body);
    const dashboard = await reloadDashboard(allianceId, sessionId);
    return NextResponse.json({
      depositSlip: serializeDepositSlip(row),
      dashboard,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status =
      message === "Deposit slip not found." || message === "Bank not found."
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const { sessionId, allianceId } = auth;
  const denied = await requireBankWrite(sessionId);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    await deleteDepositSlip(allianceId, id);
    const dashboard = await reloadDashboard(allianceId, sessionId);
    return NextResponse.json({ dashboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message === "Deposit slip not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
