import { after, NextResponse } from "next/server";

import { applyExcusedAction, loadExcusedReview } from "@/lib/time-off/excused-actions.server";
import { requireExcusedSyncOfficer, excusedSyncErrorResponse } from "@/lib/time-off/excused-route.server";
import { syncAllianceExcuses } from "@/lib/time-off/excused-worker.server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const context = await requireExcusedSyncOfficer();
  if ("error" in context) return context.error;
  try {
    return NextResponse.json(await loadExcusedReview(context.actor, (await params).id));
  } catch (error) { return excusedSyncErrorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  const context = await requireExcusedSyncOfficer();
  if ("error" in context) return context.error;
  try {
    await applyExcusedAction(context.actor, (await params).id, await request.json());
    after(() => syncAllianceExcuses(context.actor.allianceId));
    return NextResponse.json({ ok: true });
  } catch (error) { return excusedSyncErrorResponse(error); }
}
