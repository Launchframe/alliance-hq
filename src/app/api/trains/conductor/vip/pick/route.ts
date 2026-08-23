import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  assignVipOnLockedConductor,
  getConductorRecord,
} from "@/lib/trains/repository";
import { getMemberRankAsOf } from "@/lib/trains/rank-history";
import { getServerCalendarDate } from "@/lib/trains/service";
import { supportsManualVipPick } from "@/lib/trains/templates";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

/**
 * Manual VIP / Guardian pick is an open roster assign after lock. It must not
 * seed, claim, or release depleting pools — those are conductor-wheel only.
 */
export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
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

  const memberId = body.memberId.trim();
  const memberName = body.memberName.trim();
  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
      .seasonKey;
    const existing = await getConductorRecord(ctx.allianceId, date, seasonKey);
    if (!existing?.lockedAt) {
      return NextResponse.json(
        { error: "Lock the conductor before assigning VIP." },
        { status: 409 },
      );
    }
    if (!existing.conductorMemberId) {
      return NextResponse.json(
        { error: "No conductor set for this day." },
        { status: 400 },
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

    const rankEvent = await getMemberRankAsOf(
      ctx.allianceId,
      memberId,
      date,
    );

    const record = await assignVipOnLockedConductor({
      allianceId: ctx.allianceId,
      date,
      seasonKey,
      vipMemberId: memberId,
      vipMemberName: memberName,
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
