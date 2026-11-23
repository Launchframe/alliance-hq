import { NextResponse } from "next/server";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getConductorRecord,
  markConductorNoVip,
} from "@/lib/trains/repository";
import { getServerCalendarDate } from "@/lib/trains/service";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { withTrainCoverage } from "@/lib/time-off/train-coverage-route.server";

export const dynamic = "force-dynamic";

/**
 * Record that this train has no VIP. The seat is never left blank: officers
 * either assign a member or mark this absence, which is a violation against
 * the conductor.
 */
export const POST = withTrainCoverage(post);

async function post(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as { date?: string };
  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
      .seasonKey;
    const existing = await getConductorRecord(ctx.allianceId, date, seasonKey);
    if (!existing?.conductorMemberId) {
      return NextResponse.json(
        { error: "No conductor set for this day." },
        { status: 400 },
      );
    }

    const record = await markConductorNoVip({
      allianceId: ctx.allianceId,
      date,
      seasonKey,
    });

    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action: "trains.vip_none",
      severity: "update",
      resourceType: "train_conductor_record",
      resourceId: record.id,
      resourceName: existing.conductorMemberName,
      metadata: {
        date,
        conductorMemberId: existing.conductorMemberId,
        previousVipMemberId: existing.vipMemberId ?? null,
      },
    });

    return NextResponse.json({
      record: {
        ...record,
        lockedAt: record.lockedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VIP update failed." },
      { status: 400 },
    );
  }
}
