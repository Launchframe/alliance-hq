import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  assignVipOnLockedConductor,
  getConductorRecord,
} from "@/lib/trains/repository";
import { getMemberRankAsOf } from "@/lib/trains/rank-history";
import {
  listPoolEntries,
  listUnselectedPoolEntries,
  markPoolMemberSelectedForDate,
  releasePoolSelectionForDate,
} from "@/lib/trains/pool";
import {
  depletingManualPickErrorMessage,
  evaluateDepletingManualPick,
  shouldReleasePriorPoolSelection,
} from "@/lib/trains/depleting-manual-pick.shared";
import { ensureConductorPoolSeeded, getServerCalendarDate } from "@/lib/trains/service";
import {
  supportsManualVipPick,
  vipMechanismPoolType,
} from "@/lib/trains/templates";
import type { EventTopXConfig, VipMechanismType } from "@/lib/trains/types";
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

    const priorVipMemberId = existing.vipMemberId ?? null;
    const replacingSameMember = priorVipMemberId === memberId;

    const rankEvent = await getMemberRankAsOf(
      ctx.allianceId,
      memberId,
      date,
    );

    const poolType = vipMechanismPoolType(mechanism as VipMechanismType);
    if (poolType && !replacingSameMember) {
      const vipConfig = (dayConfig.vipConfig ?? {
        eventKey: "capitol_war",
        topN: 10,
      }) as EventTopXConfig;
      await ensureConductorPoolSeeded({
        hqAllianceId: ctx.allianceId,
        poolType,
        date,
        useSequence: false,
        eventTopN: vipConfig.topN ?? 10,
      });
      // Mirror conductor manual pick: consume an unselected event_top_x slot so
      // Sun/Mon VIP cannot re-award the same commander or silently no-op mark.
      const [unselected, poolEntries] = await Promise.all([
        listUnselectedPoolEntries(ctx.allianceId, poolType),
        listPoolEntries(ctx.allianceId, poolType),
      ]);
      const gate = evaluateDepletingManualPick({
        memberId,
        unselectedMemberIds: unselected.map((row) => row.memberId),
        poolMemberIds: poolEntries.map((row) => row.memberId),
      });
      if (!gate.ok) {
        return NextResponse.json(
          { error: depletingManualPickErrorMessage(gate.reason) },
          { status: 400 },
        );
      }
      // Claim the replacement first; only release the prior VIP after assign.
      await markPoolMemberSelectedForDate(
        ctx.allianceId,
        poolType,
        memberId,
        date,
      );
    }

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

    if (
      poolType &&
      shouldReleasePriorPoolSelection({
        previousMemberId: priorVipMemberId,
        nextMemberId: memberId,
      })
    ) {
      await releasePoolSelectionForDate(
        ctx.allianceId,
        date,
        priorVipMemberId!,
      );
    }

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
