import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getConductorRecord,
  lockConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import { getMemberRankAsOf } from "@/lib/trains/rank-history";
import {
  getServerCalendarDate,
  refreshExhaustedPoolsForDay,
} from "@/lib/trains/service";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    date?: string;
    memberId?: string;
    memberName?: string;
  };

  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
      .seasonKey;
    let record = await getConductorRecord(ctx.allianceId, date, seasonKey);

    if (body.memberId && body.memberName) {
      const rankEvent = await getMemberRankAsOf(
        ctx.allianceId,
        body.memberId,
        date,
      );
      record = await upsertConductorDraft({
        allianceId: ctx.allianceId,
        date,
        seasonKey,
        conductorMemberId: body.memberId,
        conductorMemberName: body.memberName,
        conductorRankEventId: rankEvent?.id ?? null,
      });
    }

    if (!record) {
      return NextResponse.json(
        { error: "Roll or select a conductor first." },
        { status: 400 },
      );
    }

    const locked = await lockConductorRecord(record.id, ctx.allianceId);
    const poolsRefreshed = await refreshExhaustedPoolsForDay({
      allianceId: ctx.allianceId,
      date,
      connection: ctx.connection,
      ashedAllianceId: ctx.ashedAllianceId,
      seasonKey,
    });

    return NextResponse.json({ record: locked, poolsRefreshed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lock failed.";
    const status = message.includes("already locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
