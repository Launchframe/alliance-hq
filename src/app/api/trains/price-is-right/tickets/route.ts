import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  getAllianceRanksAsOf,
  isMemberEligibleForPool,
} from "@/lib/trains/rank-history";
import {
  buildPriceIsRightWeightedCandidates,
  loadPriceIsRightTicketSettings,
} from "@/lib/trains/train-economy-threshold.server";
import {
  priceIsRightWeightingActive,
  resolveCliffPoints,
} from "@/lib/trains/train-price-is-right-tickets.shared";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const trainDate = new URL(request.url).searchParams.get("date")?.trim();
  if (!trainDate || !/^\d{4}-\d{2}-\d{2}$/.test(trainDate)) {
    return NextResponse.json(
      { error: "date query parameter (YYYY-MM-DD) is required." },
      { status: 400 },
    );
  }

  const { seasonKey } = await getEffectiveSeasonForAlliance(ctx.allianceId);
  const dayConfig = await resolveRollDayConfig(
    ctx.allianceId,
    trainDate,
    seasonKey,
  );
  if (dayConfig.paintTemplate !== "price_is_right") {
    return NextResponse.json(
      { error: "Selected day is not a Price Is Freight train day." },
      { status: 400 },
    );
  }

  const settings = await loadPriceIsRightTicketSettings(ctx.allianceId);
  if (!priceIsRightWeightingActive(settings)) {
    return NextResponse.json(
      { error: "Exponential ticket weighting is not enabled for this alliance." },
      { status: 400 },
    );
  }

  const [members, rankEvents] = await Promise.all([
    loadActiveAlliancePoolMembers({
      allianceId: ctx.allianceId,
      ashedAllianceId: ctx.ashedAllianceId,
      connection: ctx.connection,
    }),
    getAllianceRanksAsOf(ctx.allianceId, trainDate),
  ]);
  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );

  const candidates = members.flatMap((member) => {
    const rankEvent = rankByMember.get(member.ashedMemberId);
    const rank = rankEvent?.allianceRank ?? member.allianceRank ?? null;
    if (!isMemberEligibleForPool("r3", rank)) return [];
    return [
      {
        memberId: member.ashedMemberId,
        memberName: member.currentName,
        allianceRank: rank,
      },
    ];
  });

  let viewerMemberId: string | null = null;
  if (session.hqUserId) {
    const link = await getHqMemberLinkForUser(
      ctx.allianceId,
      session.hqUserId,
    );
    viewerMemberId = link?.ashedMemberId ?? null;
  }

  const weighted = await buildPriceIsRightWeightedCandidates({
    allianceId: ctx.allianceId,
    trainDate,
    connection: ctx.connection,
    ashedAllianceId: ctx.ashedAllianceId,
    candidates,
    settings,
    viewerMemberId,
  });

  const viewerEntry =
    weighted.board.find((entry) => entry.memberId === viewerMemberId) ?? null;

  return NextResponse.json({
    trainDate,
    scoreDate: weighted.scoreDate,
    settings: {
      weightingEnabled: settings.weightingEnabled,
      cliffPoints: settings.cliffPoints,
      effectiveCliffPoints: resolveCliffPoints(settings),
      hardCutoffEnabled: settings.hardCutoffEnabled,
    },
    viewer: viewerMemberId
      ? {
          memberId: viewerMemberId,
          ticketCount: viewerEntry?.ticketCount ?? 0,
          priorDayVsScore: viewerEntry?.priorDayVsScore ?? null,
          winProbability: viewerEntry?.winProbability ?? 0,
        }
      : null,
    board: weighted.board,
  });
}
