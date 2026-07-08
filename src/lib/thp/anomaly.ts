import {
  THP_ANOMALY_GAP,
  THP_ANOMALY_MIN_REPORTERS,
  THP_OFFICER_REVIEW_THRESHOLD,
} from "@/lib/thp/constants";

export function peerMaxThpExcludingCommander(
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

export function shouldThpAnomalyConfirm(input: {
  proposedTotal: number;
  reporterCount: number;
  peerMax: number;
}): boolean {
  if (input.reporterCount < THP_ANOMALY_MIN_REPORTERS) return false;
  if (input.proposedTotal > THP_OFFICER_REVIEW_THRESHOLD) return true;
  if (input.peerMax <= 0) return false;
  return input.proposedTotal >= input.peerMax + THP_ANOMALY_GAP;
}

export function buildThpFlagReason(proposedTotal: number, peerMax: number): string {
  if (proposedTotal > THP_OFFICER_REVIEW_THRESHOLD) {
    return `above_${THP_OFFICER_REVIEW_THRESHOLD}`;
  }
  return `peer_gap_${Math.round(proposedTotal - peerMax)}`;
}
