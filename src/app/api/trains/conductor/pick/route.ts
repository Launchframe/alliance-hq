import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  getConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import { getMemberRankAsOf } from "@/lib/trains/rank-history";
import { releasePoolSelectionForDate } from "@/lib/trains/pool";
import { getServerCalendarDate } from "@/lib/trains/service";
import {
  conductorMechanismPoolType,
  supportsManualConductorPick,
} from "@/lib/trains/templates";
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

  if (!body.memberId?.trim() || !body.memberName?.trim()) {
    return NextResponse.json(
      { error: "memberId and memberName are required." },
      { status: 400 },
    );
  }

  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
      .seasonKey;
    const existing = await getConductorRecord(ctx.allianceId, date, seasonKey);
    if (existing?.lockedAt) {
      return NextResponse.json(
        { error: "Conductor is already locked for this day." },
        { status: 409 },
      );
    }

    const dayConfig = await resolveRollDayConfig(
      ctx.allianceId,
      date,
      seasonKey,
    );
    const mechanism = dayConfig.conductorMechanism;
    if (!supportsManualConductorPick(mechanism)) {
      return NextResponse.json(
        { error: "Manual conductor pick is not allowed for this day." },
        { status: 400 },
      );
    }

    if (
      existing?.conductorMemberId &&
      conductorMechanismPoolType(mechanism)
    ) {
      await releasePoolSelectionForDate(
        ctx.allianceId,
        date,
        existing.conductorMemberId,
      );
    }

    const rankEvent = await getMemberRankAsOf(
      ctx.allianceId,
      body.memberId.trim(),
      date,
    );

    const record = await upsertConductorDraft({
      allianceId: ctx.allianceId,
      date,
      seasonKey,
      conductorMemberId: body.memberId.trim(),
      conductorMemberName: body.memberName.trim(),
      conductorRankEventId: rankEvent?.id ?? null,
      conductorMechanism: mechanism,
      vipMechanism: dayConfig.vipMechanism ?? null,
      dayConfigId: dayConfig.dayConfigId,
    });

    return NextResponse.json({
      record: {
        ...record,
        lockedAt: record.lockedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pick failed." },
      { status: 400 },
    );
  }
}
