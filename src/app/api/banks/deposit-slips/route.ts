import { NextResponse } from "next/server";

import {
  serializeDepositSlip,
  validateDepositSlipPayload,
  type DepositSlipPayload,
} from "@/lib/banks/api.shared";
import { resolveDepositSlipMemberLinks } from "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server";
import { createDepositSlip } from "@/lib/banks/repository.server";
import { reloadBankManagementDashboard } from "@/lib/banks/reload-dashboard.server";
import {
  requireBankAllianceContext,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";

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
    let payload = body;
    const needsMemberResolve =
      body.allianceMemberId == null ||
      body.commanderId == null ||
      body.depositAllianceId == null;
    if (needsMemberResolve) {
      const links = await resolveDepositSlipMemberLinks({
        bankAllianceId: allianceId,
        depositAllianceTag: body.depositAllianceTag,
        commanderName: body.commanderName,
      });
      payload = {
        ...body,
        depositAllianceId: body.depositAllianceId ?? links.depositAllianceId,
        commanderId: body.commanderId ?? links.commanderId,
        allianceMemberId: body.allianceMemberId ?? links.allianceMemberId,
      };
    }

    const row = await createDepositSlip(allianceId, payload);
    const dashboard = await reloadBankManagementDashboard(allianceId, sessionId);
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
