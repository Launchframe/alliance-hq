import { NextResponse } from "next/server";

import {
  buildLiveDepositFalloff,
  parseHorizonHoursParam,
} from "@/lib/banks/deposit-projections.server";
import {
  requireBankAllianceContext,
  requireBankRead,
} from "@/lib/banks/route-helpers.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Per-bank live deposit falloff series. */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const denied = await requireBankRead(auth.sessionId);
  if (denied) return denied;

  const { id: bankId } = await context.params;
  const url = new URL(request.url);
  const horizonHours = parseHorizonHoursParam(
    url.searchParams.get("horizonHours"),
  );

  try {
    const points = await buildLiveDepositFalloff(auth.allianceId, {
      bankId,
      horizonHours,
    });
    return NextResponse.json({ points });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message === "Bank not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
