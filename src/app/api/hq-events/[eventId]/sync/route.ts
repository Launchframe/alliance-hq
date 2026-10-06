import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { syncEventResults } from "@/lib/hq-events/ashed-sync.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

type Props = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: Props) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;
    const session = sessionOrError;
    // Score permission + scoped Ashed authority: the caller writes scores for
    // this alliance and the sync engine only runs with their session
    // credential against their linked Ashed alliance.
    const denied = await requireSessionPermission(session.id, "scores:write");
    if (denied) return denied;

    const allianceId = resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ error: "alliance_required" }, { status: 400 });
    }

    const { eventId } = await params;
    let boardIds: string[] | undefined;
    try {
      const body = (await request.json()) as { boardIds?: string[] };
      if (Array.isArray(body?.boardIds)) boardIds = body.boardIds;
    } catch {
      // Body optional — sync all boards.
    }

    const summary = await syncEventResults(
      {
        allianceId,
        hqUserId: session.hqUserId ?? null,
        sessionId: session.id,
      },
      { eventId, boardIds },
    );
    return NextResponse.json({ sync: summary });
  } catch {
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
