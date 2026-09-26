import { after, NextResponse } from "next/server";

import { applyExcusedAction, loadExcusedReview } from "@/lib/time-off/excused-actions.server";
import { requireExcusedSyncOfficer, excusedSyncErrorResponse, refreshExcusedCredentialsFromSession } from "@/lib/time-off/excused-route.server";
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
    const id = (await params).id;
    const body = await request.json();
    if (body?.action === "retry") {
      const review = await loadExcusedReview(context.actor, id);
      if (
        body?.version === review.version &&
        review.bindings.some((binding) => binding.status === "credentials_required")
      ) {
        await refreshExcusedCredentialsFromSession({
          sessionId: context.sessionId,
          allianceId: context.actor.allianceId,
          hqUserId: context.actor.hqUserId!,
        });
      }
    }
    await applyExcusedAction(context.actor, id, body);
    after(() => syncAllianceExcuses(context.actor.allianceId));
    return NextResponse.json({ ok: true });
  } catch (error) { return excusedSyncErrorResponse(error); }
}
