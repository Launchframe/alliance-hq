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
  supportsManualVipPick,
  vipMechanismPoolType,
} from "@/lib/trains/templates";
import type { VipMechanismType } from "@/lib/trains/types";
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
    guardianIsVip?: boolean;
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
        { error: "Train is locked; VIP cannot be changed." },
        { status: 409 },
      );
    }

    const dayConfig = await resolveRollDayConfig(
      ctx.allianceId,
      date,
      seasonKey,
    );
    const mechanism = dayConfig.vipMechanism ?? "none";
    if (!supportsManualVipPick(mechanism)) {
      return NextResponse.json(
        { error: "Manual VIP pick is not allowed for this day." },
        { status: 400 },
      );
    }

    if (
      existing?.vipMemberId &&
      vipMechanismPoolType(mechanism as VipMechanismType)
    ) {
      await releasePoolSelectionForDate(
        ctx.allianceId,
        date,
        existing.vipMemberId,
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
      vipMemberId: body.memberId.trim(),
      vipMemberName: body.memberName.trim(),
      vipRankEventId: rankEvent?.id ?? null,
      vipMechanism: mechanism,
      dayConfigId: dayConfig.dayConfigId,
      guardianIsVip: body.guardianIsVip ? 1 : 0,
    });

    return NextResponse.json({
      record: {
        ...record,
        lockedAt: record.lockedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VIP pick failed." },
      { status: 400 },
    );
  }
}
