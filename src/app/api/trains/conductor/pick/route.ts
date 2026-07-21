import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  getConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import {
  getMemberRankAsOf,
  isMemberEligibleForPool,
  resolveMemberAllianceRankAsOf,
} from "@/lib/trains/rank-history";
import {
  listPoolEntries,
  listUnselectedPoolEntries,
  markPoolMemberSelectedForDate,
  releasePoolSelectionForDate,
} from "@/lib/trains/pool";
import {
  depletingManualPickErrorMessage,
  evaluateDepletingManualPick,
} from "@/lib/trains/depleting-manual-pick.shared";
import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";
import {
  ensureConductorPoolSeeded,
  getServerCalendarDate,
} from "@/lib/trains/service";
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

  const memberId = body.memberId?.trim();
  const memberName = body.memberName?.trim();
  if (!memberId || !memberName) {
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

    const depletingPool =
      !isPriceIsRightPaintTemplate(dayConfig.paintTemplate) &&
      Boolean(conductorMechanismPoolType(mechanism));

    if (existing?.conductorMemberId && depletingPool) {
      await releasePoolSelectionForDate(
        ctx.allianceId,
        date,
        existing.conductorMemberId,
      );
    }

    const rankEvent = await getMemberRankAsOf(
      ctx.allianceId,
      memberId,
      date,
    );

    if (dayConfig.paintTemplate === "r3_recognition") {
      const { loadActiveAlliancePoolMembers } = await import(
        "@/lib/members/game-roster"
      );
      const members = await loadActiveAlliancePoolMembers({
        allianceId: ctx.allianceId,
      });
      const rosterMember = members.find(
        (m) => m.ashedMemberId === memberId,
      );
      const resolvedRank = await resolveMemberAllianceRankAsOf(
        ctx.allianceId,
        memberId,
        date,
        rosterMember?.allianceRank ?? null,
        rosterMember?.allianceRankTitle ?? null,
      );
      if (!isMemberEligibleForPool("r3", resolvedRank.rank)) {
        return NextResponse.json(
          { error: "R3 recognition awards must pick an R3 member." },
          { status: 400 },
        );
      }
    }

    const poolType = depletingPool
      ? conductorMechanismPoolType(mechanism)
      : null;
    if (poolType) {
      await ensureConductorPoolSeeded({
        hqAllianceId: ctx.allianceId,
        poolType,
        date,
        useSequence: mechanism === "r4_sequence",
        paintTemplate: dayConfig.paintTemplate,
        respectConductorMinimums: false,
      });
      // After releasing today's prior pick (if any), the member must still be an
      // unselected slot — otherwise R3 recognition / lottery "depleting" awards
      // can re-award the same commander every day.
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
      await markPoolMemberSelectedForDate(
        ctx.allianceId,
        poolType,
        memberId,
        date,
      );
    }

    const record = await upsertConductorDraft({
      allianceId: ctx.allianceId,
      date,
      seasonKey,
      conductorMemberId: memberId,
      conductorMemberName: memberName,
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
