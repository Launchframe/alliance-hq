"use client";

import type { ScoreLeaderboardPayload } from "@/lib/trains/score-leaderboard-podium.shared";
import { usesPriceIsFreightConductorRoll } from "@/lib/trains/heavy-hitter-pool.shared";

export type ConductorShareScoreProof = {
  priorDayVsScore: number | null;
  leaderboardRank: number | null;
  winProbability: number | null;
};

type TicketsBoardPayload = {
  board?: Array<{
    memberId: string;
    priorDayVsScore: number;
    winProbability: number;
    ticketCount: number;
  }>;
};

/**
 * Load VS score proof for a conductor share image when the dashboard/card
 * path has no roll payload (no priorDayVsScore on the stored record).
 */
export async function fetchConductorShareScoreProof(input: {
  trainDate: string;
  memberId: string;
  paintTemplate: string | null | undefined;
  mechanism: string | null | undefined;
}): Promise<ConductorShareScoreProof> {
  if (usesPriceIsFreightConductorRoll(input.paintTemplate)) {
    try {
      const res = await fetch(
        `/api/trains/price-is-right/tickets?date=${encodeURIComponent(input.trainDate)}`,
      );
      if (!res.ok) {
        return emptyProof();
      }
      const body = (await res.json()) as TicketsBoardPayload;
      const row = body.board?.find((entry) => entry.memberId === input.memberId);
      if (!row) return emptyProof();
      return {
        priorDayVsScore: row.priorDayVsScore > 0 ? row.priorDayVsScore : null,
        leaderboardRank: null,
        winProbability:
          row.winProbability > 0 ? row.winProbability : null,
      };
    } catch {
      return emptyProof();
    }
  }

  const isVsBoard =
    input.mechanism === "vs_top_10" ||
    input.mechanism === "vs_high_score" ||
    input.mechanism === "vs_top_n" ||
    input.mechanism === "vr_top_n";
  if (!isVsBoard) return emptyProof();

  try {
    const res = await fetch(
      `/api/trains/score-leaderboard?date=${encodeURIComponent(input.trainDate)}`,
    );
    if (!res.ok) return emptyProof();
    const body = (await res.json()) as ScoreLeaderboardPayload;
    const row = body.entries.find((entry) => entry.memberId === input.memberId);
    if (!row) return emptyProof();
    return {
      priorDayVsScore: row.score > 0 ? row.score : null,
      leaderboardRank: row.rank >= 1 ? row.rank : null,
      winProbability: null,
    };
  } catch {
    return emptyProof();
  }
}

function emptyProof(): ConductorShareScoreProof {
  return {
    priorDayVsScore: null,
    leaderboardRank: null,
    winProbability: null,
  };
}
