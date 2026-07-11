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

/** Alliance-wide live deposit falloff series. */
export async function GET(request: Request) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const denied = await requireBankRead(auth.sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const horizonHours = parseHorizonHoursParam(
    url.searchParams.get("horizonHours"),
  );

  try {
    const points = await buildLiveDepositFalloff(auth.allianceId, {
      horizonHours,
    });
    return NextResponse.json({ points });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
