import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { lockConductorsForDates } from "@/lib/trains/service";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as { dates?: string[] };
  const dates = Array.isArray(body.dates)
    ? body.dates.filter((date) => typeof date === "string" && date.trim())
    : [];

  if (dates.length === 0) {
    return NextResponse.json({ error: "No dates to lock." }, { status: 400 });
  }

  try {
    const { records, poolsRefreshed } = await lockConductorsForDates({
      allianceId: ctx.allianceId,
      dates,
      connection: ctx.connection,
      ashedAllianceId: ctx.ashedAllianceId,
    });
    return NextResponse.json({ records, poolsRefreshed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lock failed.";
    const status = message.includes("already locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
