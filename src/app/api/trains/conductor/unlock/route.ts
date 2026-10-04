import { NextResponse } from "next/server";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getConductorRecord,
  unlockConductorRecord,
} from "@/lib/trains/repository";
import { getServerCalendarDate } from "@/lib/trains/service";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  canUnlockLockedConductor,
  TRAIN_OWNERSHIP_REQUIRED_CODE,
} from "@/lib/trains/train-ownership.shared";
import {
  resolveTrainActorHqUserId,
  sessionCanUnlimitedUnlockConductor,
} from "@/lib/trains/train-ownership.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    const record = await getConductorRecord(ctx.allianceId, date, seasonKey);

    if (!record) {
      return NextResponse.json(
        { error: "No conductor record for this day." },
        { status: 404 },
      );
    }

    const actorHqUserId = await resolveTrainActorHqUserId(session.id);
    const unlimitedUnlock = await sessionCanUnlimitedUnlockConductor(
      session.id,
      ctx.allianceId,
    );
    if (
      !canUnlockLockedConductor({
        unlimitedUnlock,
        actorHqUserId,
        lockedByHqUserId: record.lockedByHqUserId,
        trainDate: record.date,
        today: getServerCalendarDate(),
        lockedAt: record.lockedAt,
      })
    ) {
      return NextResponse.json(
        {
          error:
            "Ask the alliance owner or a platform maintainer to unlock this conductor.",
          code: TRAIN_OWNERSHIP_REQUIRED_CODE,
          date,
          conductorName: record.conductorMemberName,
        },
        { status: 403 },
      );
    }

    const unlocked = await unlockConductorRecord(record.id, ctx.allianceId);

    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action: "trains.conductor_unlock",
      severity: "update",
      resourceType: "train_conductor_record",
      resourceId: record.id,
      resourceName: record.conductorMemberName,
      metadata: {
        date,
        conductorMemberId: record.conductorMemberId,
        previousLockedAt: record.lockedAt?.toISOString() ?? null,
        previousLockedByHqUserId: record.lockedByHqUserId,
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
