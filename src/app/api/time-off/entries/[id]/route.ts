import { NextResponse } from "next/server";

import { cancelTimeOff, updateTimeOff } from "@/lib/time-off/mutations.server";
import { requireTimeOffActor, timeOffErrorResponse } from "@/lib/time-off/route-helpers.server";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const context = await requireTimeOffActor();
  if ("error" in context) return context.error;
  try {
    const { id } = await params;
    const body = await request.json();
    return NextResponse.json({ entry: await updateTimeOff(context.actor, id, body, body?.version) });
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
    return NextResponse.json({ entry: await cancelTimeOff(context.actor, id, body?.version) });
  } catch (error) {
    return timeOffErrorResponse(error);
  }
}
