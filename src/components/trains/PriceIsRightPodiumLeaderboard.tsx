"use client";

import { ScoreLeaderboardPodium } from "@/components/trains/ScoreLeaderboardPodium";

type Props = {
  trainDate: string;
};

/** Thin wrapper kept for existing call sites — delegates to the generalized score podium. */
export function PriceIsRightPodiumLeaderboard({ trainDate }: Props) {
  return <ScoreLeaderboardPodium trainDate={trainDate} kind="tpif" />;
}
