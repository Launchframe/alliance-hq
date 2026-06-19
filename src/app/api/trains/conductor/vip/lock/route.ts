import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import { getMemberRankAsOf } from "@/lib/trains/rank-history";
import { getServerCalendarDate } from "@/lib/trains/service";
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
        { error: "Conductor is already locked for this day." },
        { status: 409 },
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
      guardianIsVip: body.guardianIsVip ? 1 : 0,
    });

    return NextResponse.json({ record });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VIP lock failed." },
      { status: 400 },
    );
  }
}
