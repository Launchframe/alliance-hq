import {
  KILLS_ANOMALY_GAP,
  KILLS_ANOMALY_MIN_REPORTERS,
  KILLS_OFFICER_REVIEW_THRESHOLD,
} from "@/lib/kills/constants";

export function peerMaxKillsExcludingCommander(
  rows: Array<{ commanderId: string; total: number }>,
  excludeCommanderId: string,
): number {
  let max = 0;
  for (const row of rows) {
    if (row.commanderId === excludeCommanderId) continue;
    if (row.total > max) max = row.total;
  }
  return max;
}

export function shouldKillsAnomalyConfirm(input: {
  proposedTotal: number;
  reporterCount: number;
  peerMax: number;
}): boolean {
  if (input.reporterCount < KILLS_ANOMALY_MIN_REPORTERS) return false;
  if (input.proposedTotal > KILLS_OFFICER_REVIEW_THRESHOLD) return true;
  if (input.peerMax <= 0) return false;
  return input.proposedTotal >= input.peerMax + KILLS_ANOMALY_GAP;
}

export function buildKillsFlagReason(proposedTotal: number, peerMax: number): string {
  if (proposedTotal > KILLS_OFFICER_REVIEW_THRESHOLD) {
    return `above_${KILLS_OFFICER_REVIEW_THRESHOLD}`;
  }
  return `peer_gap_${Math.round(proposedTotal - peerMax)}`;
}
