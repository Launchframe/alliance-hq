import { NextResponse } from "next/server";

import { cancelTimeOff, updateTimeOff } from "@/lib/time-off/mutations.server";
import { dualWriteTimeOffToAshed } from "@/lib/time-off/excused-sync.server";
import { requireTimeOffActor, timeOffErrorResponse } from "@/lib/time-off/route-helpers.server";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const context = await requireTimeOffActor();
  if ("error" in context) return context.error;
  try {
    const { id } = await params;
    const body = await request.json();
    const entry = await updateTimeOff(context.actor, id, body, body?.version);
    const ashedSyncFailed = await dualWriteTimeOffToAshed({
      allianceId: context.actor.allianceId,
      entryId: entry.id,
      sessionId: context.actor.sessionId,
      discordUserId: context.actor.discordUserId,
      operation: "upsert",
    });
    return NextResponse.json({ entry, ashedSyncFailed });
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
    const ashedSyncFailed = await dualWriteTimeOffToAshed({
      allianceId: context.actor.allianceId,
      entryId: entry.id,
      sessionId: context.actor.sessionId,
      discordUserId: context.actor.discordUserId,
      operation: "delete",
    });
    return NextResponse.json({ entry, ashedSyncFailed });
  } catch (error) {
    return timeOffErrorResponse(error);
  }
}
