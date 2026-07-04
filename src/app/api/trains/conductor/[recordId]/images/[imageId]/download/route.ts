import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { loadFinalizedConductorImageBytes } from "@/lib/trains/conductor-images.server";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ recordId: string; imageId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const { recordId, imageId } = await context.params;
  const payload = await loadFinalizedConductorImageBytes({
    allianceId: ctx.allianceId,
    conductorRecordId: recordId,
    imageId,
  });

  if (!payload) {
    return NextResponse.json({ error: "Finalized image not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(payload.bytes), {
    status: 200,
    headers: {
      "Content-Type": payload.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
