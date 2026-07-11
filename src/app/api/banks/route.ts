import { NextResponse } from "next/server";

import {
  serializeBank,
  validateBankPayload,
  type BankPayload,
} from "@/lib/banks/api.shared";
import { loadBankManagementDashboard } from "@/lib/banks/load-dashboard.server";
import {
  buildBankManagementPayload,
  createBank,
  loadBanksWithSlips,
} from "@/lib/banks/repository.server";
import {
  requireBankAllianceContext,
  requireBankRead,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { sessionHasPermission } from "@/lib/rbac/context";
import { BANK_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await requireBankAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId } = context;
  const denied = await requireBankRead(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const nextCaptureLevelRaw = url.searchParams.get("nextCaptureLevel");
  const nextCaptureLevel =
    nextCaptureLevelRaw != null && nextCaptureLevelRaw !== ""
      ? Number(nextCaptureLevelRaw)
      : null;

  const dashboard = await loadBankManagementDashboard(sessionId, {
    nextCaptureLevel:
      nextCaptureLevel != null && Number.isFinite(nextCaptureLevel)
        ? nextCaptureLevel
        : null,
  });

  if (!dashboard || "forbidden" in dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(dashboard);
}

export async function POST(request: Request) {
  const context = await requireBankAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBankWrite(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as BankPayload;
  const validationError = validateBankPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const row = await createBank(allianceId, body);
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
      bank: serializeBank(row),
      dashboard,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
