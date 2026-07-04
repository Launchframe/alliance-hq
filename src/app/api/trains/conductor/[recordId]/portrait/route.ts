import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveConductorPortrait } from "@/lib/trains/portrait-resolution.server";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ recordId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const { recordId } = await context.params;
  const portrait = await resolveConductorPortrait({
    allianceId: ctx.allianceId,
    conductorRecordId: recordId,
  });

  return NextResponse.json({ portrait });
}
