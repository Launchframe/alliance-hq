import { after, NextResponse } from "next/server";

import { cancelTimeOff, updateTimeOff } from "@/lib/time-off/mutations.server";
import { requireTimeOffActor, timeOffErrorResponse } from "@/lib/time-off/route-helpers.server";
import { syncAllianceExcuses } from "@/lib/time-off/excused-worker.server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const context = await requireTimeOffActor();
  if ("error" in context) return context.error;
  try {
    const { id } = await params;
    const body = await request.json();
    const entry = await updateTimeOff(context.actor, id, body, body?.version);
    if (entry.syncStatus !== "local") after(async () => { await syncAllianceExcuses(context.actor.allianceId); });
    return NextResponse.json({ entry });
  } catch (error) {
    return timeOffErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const context = await requireTimeOffActor();
  if ("error" in context) return context.error;
  try {
    const { id } = await params;
    const body = await request.json();
    const entry = await cancelTimeOff(context.actor, id, body?.version);
    if (entry.syncStatus !== "local") after(async () => { await syncAllianceExcuses(context.actor.allianceId); });
    return NextResponse.json({ entry });
  } catch (error) {
    return timeOffErrorResponse(error);
  }
}
