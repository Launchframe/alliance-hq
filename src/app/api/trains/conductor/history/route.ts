import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { parseConductorHistoryQueryParams } from "@/lib/trains/conductor-history-query.shared";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { listLockedConductorHistory } from "@/lib/trains/repository";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const query = parseConductorHistoryQueryParams(url.searchParams);
  const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
    .seasonKey;
  const maxDate = getServerCalendarDate();

  const { rows, total } = await listLockedConductorHistory({
    allianceId: ctx.allianceId,
    seasonKey,
    maxDate,
    ...query,
  });

  return NextResponse.json({
    total,
    offset: query.offset,
    limit: query.limit,
    records: rows.map((row) => ({
      id: row.id,
      date: row.date,
      conductorMemberId: row.conductorMemberId,
      conductorMemberName: row.conductorMemberName,
      vipMemberId: row.vipMemberId,
      vipMemberName: row.vipMemberName,
      conductorMechanism: row.conductorMechanism,
      vipMechanism: row.vipMechanism,
      guardianIsVip: row.guardianIsVip === 1,
      lockedAt: row.lockedAt?.toISOString() ?? null,
    })),
  });
}
