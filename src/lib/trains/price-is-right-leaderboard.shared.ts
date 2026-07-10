import { formatPriceIsRightVsScore } from "@/lib/trains/train-price-is-right-tickets.shared";
import { PRICE_IS_RIGHT_MIN_VS_SCORE } from "@/lib/trains/train-economy-threshold.shared";

export type PriceIsRightLeaderboardEntry = {
  rank: number;
  memberId: string;
  memberName: string;
  priorDayVsScore: number;
  isViewer?: boolean;
};

export type PriceIsRightLeaderboardCandidate = {
  memberId: string;
  memberName: string;
};

function distanceAboveSweetSpot(score: number): number {
  return score - PRICE_IS_RIGHT_MIN_VS_SCORE;
}

/** R3 members with prior-day VS ≥ 7.2M, ranked closest to 7.2M from above. */
export function buildPriceIsRightVsLeaderboard(
  candidates: PriceIsRightLeaderboardCandidate[],
  vsScores: Map<string, number>,
  viewerMemberId?: string | null,
): PriceIsRightLeaderboardEntry[] {
  const ranked = candidates
    .map((candidate) => ({
      memberId: candidate.memberId,
      memberName: candidate.memberName,
      priorDayVsScore: vsScores.get(candidate.memberId) ?? 0,
      isViewer: viewerMemberId === candidate.memberId,
    }))
    .filter(
      (entry) => entry.priorDayVsScore >= PRICE_IS_RIGHT_MIN_VS_SCORE,
    )
    .sort((a, b) => {
      const distA = distanceAboveSweetSpot(a.priorDayVsScore);
      const distB = distanceAboveSweetSpot(b.priorDayVsScore);
      if (distA !== distB) return distA - distB;
      return a.memberName.localeCompare(b.memberName);
    });

  return ranked.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

export function formatPriceIsRightLeaderboardEntryLine(
  entry: Pick<PriceIsRightLeaderboardEntry, "rank" | "memberName" | "priorDayVsScore">,
): string {
  return `#${entry.rank} ${entry.memberName} — ${formatPriceIsRightVsScore(entry.priorDayVsScore)}`;
}

const PODIUM_MEDALS = ["🥇", "🥈", "🥉"] as const;

export function formatPriceIsRightLeaderboardDiscordMessage(input: {
  scoreDate: string;
  trainDate: string;
  entries: PriceIsRightLeaderboardEntry[];
  trainsUrl?: string | null;
}): string {
  const podium = input.entries.slice(0, 3);
  if (podium.length === 0) {
    return (
      `**The Price Is Freight** (${input.trainDate})\n` +
      `No prior-day VS scores on record for **${input.scoreDate}** yet.`
    );
  }

  const lines = podium.map((entry, index) => {
    const medal = PODIUM_MEDALS[index] ?? `${entry.rank}.`;
    return `${medal} **${formatPriceIsRightLeaderboardEntryLine(entry)}**`;
  });

  const footer = input.trainsUrl?.trim()
    ? `\n\nView the full board: ${input.trainsUrl.trim()}`
    : "";

  return (
    `**The Price Is Freight — closest to 7.2M** (${input.trainDate})\n` +
    `Prior-day VS from **${input.scoreDate}**:\n\n` +
    lines.join("\n") +
    footer
  );
}
