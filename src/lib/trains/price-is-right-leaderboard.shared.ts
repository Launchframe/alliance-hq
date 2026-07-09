import { formatPriceIsRightVsScore } from "@/lib/trains/train-price-is-right-tickets.shared";

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

/** Top scorers by prior-day VS (game-style individual ranking, not ticket count). */
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
    .filter((entry) => entry.priorDayVsScore > 0)
    .sort((a, b) => {
      if (b.priorDayVsScore !== a.priorDayVsScore) {
        return b.priorDayVsScore - a.priorDayVsScore;
      }
      return a.memberName.localeCompare(b.memberName);
    });

  return ranked.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
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
    return `${medal} **${entry.memberName}** — ${formatPriceIsRightVsScore(entry.priorDayVsScore)}`;
  });

  const footer = input.trainsUrl?.trim()
    ? `\n\nView the full board: ${input.trainsUrl.trim()}`
    : "";

  return (
    `**The Price Is Freight — prior-day VS podium** (${input.trainDate})\n` +
    `Scores from **${input.scoreDate}**:\n\n` +
    lines.join("\n") +
    footer
  );
}
