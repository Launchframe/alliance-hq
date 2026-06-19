import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { listLockedConductorHistory } from "@/lib/trains/repository";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, Math.floor(limitParam)), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
    .seasonKey;
  const rows = await listLockedConductorHistory(
    ctx.allianceId,
    seasonKey,
    limit,
  );

  return NextResponse.json({
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
