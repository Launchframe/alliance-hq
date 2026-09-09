import { after, NextResponse } from "next/server";

import { queueAllianceExcusedRefresh } from "@/lib/time-off/excused-actions.server";
import { requireExcusedSyncOfficer, excusedSyncErrorResponse } from "@/lib/time-off/excused-route.server";
import { syncAllianceExcuses } from "@/lib/time-off/excused-worker.server";
import { TimeOffError } from "@/lib/time-off/workflow.shared";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const context = await requireExcusedSyncOfficer();
  if ("error" in context) return context.error;
  try {
    const body = await request.json();
    if (body?.action !== "refresh") throw new TimeOffError("forbidden", 403);
    await queueAllianceExcusedRefresh(context.actor);
    after(() => syncAllianceExcuses(context.actor.allianceId));
    return NextResponse.json({ ok: true });
  } catch (error) { return excusedSyncErrorResponse(error); }
}
