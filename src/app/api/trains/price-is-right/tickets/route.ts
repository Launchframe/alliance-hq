import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  isPriceIsRightHeavyHitterSaturday,
  isPriceIsRightPaintTemplate,
} from "@/lib/trains/heavy-hitter-pool.shared";
import { buildHeavyHitterPoolCandidates } from "@/lib/trains/heavy-hitter-pool.server";
import {
  buildEqualChanceOddsBoard,
  buildUniformEconomyDrawSet,
} from "@/lib/trains/price-is-freight-roll.shared";
import { loadPriceIsFreightR3Candidates } from "@/lib/trains/price-is-freight-roll.server";
import {
  buildPriceIsRightWeightedCandidates,
  loadPriceIsRightTicketSettings,
  loadTrainEconomyThreshold,
} from "@/lib/trains/train-economy-threshold.server";
import {
  priceIsRightWeightingActive,
  resolveCliffPoints,
} from "@/lib/trains/train-price-is-right-tickets.shared";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
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
  if (!isPriceIsRightPaintTemplate(dayConfig.paintTemplate)) {
    return NextResponse.json(
      { error: "Selected day is not a Price Is Freight train day." },
      { status: 400 },
    );
  }

  const settings = await loadPriceIsRightTicketSettings(ctx.allianceId);

  let viewerMemberId: string | null = null;
  if (session.hqUserId) {
    const link = await getHqMemberLinkForUser(
      ctx.allianceId,
      session.hqUserId,
    );
    viewerMemberId = link?.ashedMemberId ?? null;
  }

  const isSaturday = isPriceIsRightHeavyHitterSaturday(
    dayConfig.paintTemplate,
    trainDate,
  );

  if (isSaturday) {
    const heavyHitters = await buildHeavyHitterPoolCandidates(
      ctx.allianceId,
      trainDate,
    );
    const board = buildEqualChanceOddsBoard(
      heavyHitters.map((c) => ({
        memberId: c.memberId,
        memberName: c.memberName,
        priorDayVsScore: 0,
        isTakedownOverride: true,
      })),
      viewerMemberId,
    );
    const viewerEntry =
      board.find((entry) => entry.memberId === viewerMemberId) ?? null;
    return NextResponse.json({
      mode: "heavy_hitter" as const,
      trainDate,
      scoreDate: vsScoreReferenceDate(trainDate),
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
            missedFloor: false,
          }
        : null,
      board,
      missedFloor: [],
    });
  }

  const candidates = await loadPriceIsFreightR3Candidates({
    allianceId: ctx.allianceId,
    date: trainDate,
  });

  if (priceIsRightWeightingActive(settings)) {
    const weighted = await buildPriceIsRightWeightedCandidates({
      allianceId: ctx.allianceId,
      trainDate,
      candidates,
      settings,
      viewerMemberId,
    });

    const viewerEntry =
      weighted.board.find((entry) => entry.memberId === viewerMemberId) ?? null;
    const viewerMissedEntry =
      weighted.missedFloor.find((entry) => entry.memberId === viewerMemberId) ??
      null;

    return NextResponse.json({
      mode: "weighted" as const,
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
            priorDayVsScore:
              viewerEntry?.priorDayVsScore ??
              viewerMissedEntry?.priorDayVsScore ??
              null,
            winProbability: viewerEntry?.winProbability ?? 0,
            missedFloor: viewerMissedEntry != null,
          }
        : null,
      board: weighted.board,
      missedFloor: weighted.missedFloor,
    });
  }

  const economy = await loadTrainEconomyThreshold(ctx.allianceId, false);
  const scoreDate = vsScoreReferenceDate(trainDate);
  const vsScores = await fetchAlliancePriorDayVsScoresByMember(
    ctx.allianceId,
    scoreDate,
  );
  const { eligible, excluded } = buildUniformEconomyDrawSet({
    candidates,
    scores: vsScores,
    settings: economy,
    maxTicketMemberIds: settings.maxTicketMemberIds,
    viewerMemberId,
  });

  const viewerEntry =
    eligible.find((entry) => entry.memberId === viewerMemberId) ?? null;
  const viewerMissedEntry =
    excluded.find((entry) => entry.memberId === viewerMemberId) ?? null;

  return NextResponse.json({
    mode: "uniform" as const,
    trainDate,
    scoreDate,
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
          priorDayVsScore:
            viewerEntry?.priorDayVsScore ??
            viewerMissedEntry?.priorDayVsScore ??
            null,
          winProbability: viewerEntry?.winProbability ?? 0,
          missedFloor: viewerMissedEntry != null,
        }
      : null,
    board: eligible,
    missedFloor: excluded,
  });
}
