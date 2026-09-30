import "server-only";

import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { resolveTrainSeasonKey } from "@/lib/trains/service";
import {
  getAllianceRanksAsOf,
  resolveMemberPoolAllianceRank,
} from "@/lib/trains/rank-history";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";
import {
  vsDatesForWeek,
  vsTrainDate,
} from "@/lib/vs-performance/weekly-plan.shared";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  buildWeeklyPifBoard,
  type WeeklyPifBoard,
  type WeeklyPifDay,
} from "@/lib/vs-performance/weekly-pif.shared";

export async function loadWeeklyPifBoard(input: {
  allianceId: string;
  weekStart: string;
  leadDays: number;
  viewerMemberId?: string | null;
  resolvedDays?: readonly {
    scoreDate: string;
    trainDate: string;
    currentRule: ConductorRule | null;
  }[];
}): Promise<WeeklyPifBoard> {
  const { allianceId, weekStart, leadDays } = input;
  const today = getServerCalendarDate();
  const seasonKey = await resolveTrainSeasonKey(allianceId);
  const scoreDates = vsDatesForWeek(weekStart);

  const [members] = await Promise.all([
    loadActiveAlliancePoolMembers({ allianceId }),
  ]);

  const days: WeeklyPifDay[] = [];
  for (const [index, scoreDate] of scoreDates.entries()) {
    const resolved = input.resolvedDays?.[index];
    const trainDate = resolved?.trainDate ?? vsTrainDate(scoreDate, leadDays);
    const rule =
      resolved !== undefined
        ? resolved.currentRule
        : (
            await resolveRollDayConfig(allianceId, trainDate, seasonKey, {
              updateSeason: false,
            })
          ).conductorRule;
    const isPifWeekday =
      rule?.kind === "price_is_freight" && rule.board === "weekday";

    if (!isPifWeekday || scoreDate >= today) {
      days.push({
        scoreDate,
        trainDate,
        isPifWeekday,
        scores: new Map(),
        eligibleMemberIds: new Set<string>(),
      });
      continue;
    }

    const scores = await fetchAlliancePriorDayVsScoresByMember(
      allianceId,
      scoreDate,
    );
    const rankEvents = await getAllianceRanksAsOf(allianceId, trainDate);
    const rankByMember = new Map(
      rankEvents.map((event) => [event.ashedMemberId, event]),
    );
    const eligibleMemberIds = new Set<string>();
    for (const member of members) {
      const rank = resolveMemberPoolAllianceRank(
        member,
        rankByMember.get(member.ashedMemberId),
      );
      if (rank === 3) eligibleMemberIds.add(member.ashedMemberId);
    }

    days.push({
      scoreDate,
      trainDate,
      isPifWeekday,
      scores,
      eligibleMemberIds,
    });
  }

  return buildWeeklyPifBoard({
    weekStart,
    serverToday: today,
    candidates: members.map((member) => ({
      memberId: member.ashedMemberId,
      memberName: member.currentName,
    })),
    days,
    viewerMemberId: input.viewerMemberId ?? null,
  });
}
