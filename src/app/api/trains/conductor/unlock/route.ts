import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getConductorRecord,
  unlockConductorRecord,
} from "@/lib/trains/repository";
import { getServerCalendarDate } from "@/lib/trains/service";
import { getOrCreateSession } from "@/lib/session";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requirePlatformMaintainer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as { date?: string };
  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
      .seasonKey;
    const record = await getConductorRecord(ctx.allianceId, date, seasonKey);

    if (!record) {
      return NextResponse.json(
        { error: "No conductor record for this day." },
        { status: 404 },
      );
    }

    const unlocked = await unlockConductorRecord(record.id, ctx.allianceId);

    await writeAuditLog({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId ?? undefined,
      action: "trains.conductor_unlock",
      resourceType: "train_conductor_record",
      resourceId: record.id,
      resourceName: record.conductorMemberName ?? undefined,
      metadata: {
        date,
        conductorMemberId: record.conductorMemberId,
        previousLockedAt: record.lockedAt?.toISOString() ?? null,
      },
    });

    return NextResponse.json({
      record: {
        ...unlocked,
        lockedAt: unlocked.lockedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unlock failed.";
    const status = message.includes("not locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
