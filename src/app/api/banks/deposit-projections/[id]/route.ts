import { NextResponse } from "next/server";

import {
  deleteDepositProjection,
  getDepositProjectionDetail,
} from "@/lib/banks/deposit-projections.server";
import {
  requireBankAllianceContext,
  requireBankRead,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const denied = await requireBankRead(auth.sessionId);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    const detail = await getDepositProjectionDetail(auth.allianceId, id);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message === "Projection not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const denied = await requireBankWrite(auth.sessionId);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    await deleteDepositProjection(auth.allianceId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message === "Projection not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
