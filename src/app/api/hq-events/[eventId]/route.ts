import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { loadEventEvidence } from "@/lib/hq-events/evidence-repository.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

type Props = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, { params }: Props) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;
    const session = sessionOrError;
    const denied = await requireSessionPermission(session.id, "events:read");
    if (denied) return denied;

    const allianceId = resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ error: "alliance_required" }, { status: 400 });
    }

    const { eventId } = await params;
    const db = getDb();
    const [event] = await db
      .select()
      .from(schema.hqEvents)
      .where(
        and(
          eq(schema.hqEvents.id, eventId),
          eq(schema.hqEvents.allianceId, allianceId),
        ),
      )
      .limit(1);
    if (!event) {
      return NextResponse.json({ error: "event_not_found" }, { status: 404 });
    }

    const evidence = await loadEventEvidence(
      {
        allianceId,
        hqUserId: session.hqUserId ?? null,
        sessionId: session.id,
      },
      { eventId },
    );

    return NextResponse.json({
      event: {
        id: event.id,
        seriesId: event.seriesId,
        name: event.name,
        scoreTarget: event.scoreTarget,
        eventFamily: event.eventFamily,
        policyVersion: event.policyVersion,
        startDate: event.startDate,
        endDate: event.endDate,
        status: event.status,
        ashedEventId: event.ashedEventId,
      },
      boards: evidence?.boards ?? [],
      resultsCount: evidence?.results.length ?? 0,
    });
  } catch {
    return NextResponse.json({ error: "event_load_failed" }, { status: 500 });
  }
}
