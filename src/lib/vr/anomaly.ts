import { ANOMALY_GAP, ANOMALY_MIN_REPORTERS, OFFICER_REVIEW_THRESHOLD } from "@/lib/vr/validation";

export function peerMaxExcludingMember(
  rows: Array<{ ashedMemberId: string; highestBaseVr: number }>,
  excludeMemberId: string,
): number {
  let max = 0;
  for (const row of rows) {
    if (row.ashedMemberId === excludeMemberId) continue;
    if (row.highestBaseVr > max) max = row.highestBaseVr;
  }
  return max;
}

export function shouldAnomalyConfirm(input: {
  proposedVr: number;
  reporterCount: number;
  peerMax: number;
}): boolean {
  if (input.reporterCount < ANOMALY_MIN_REPORTERS) return false;
  if (input.proposedVr > OFFICER_REVIEW_THRESHOLD) return true;
  if (input.peerMax <= 0) return false;
  return input.proposedVr >= input.peerMax + ANOMALY_GAP;
}

export function anomalyConfirmMessage(proposedVr: number): string {
  return `Are you *sure* your VR is ${proposedVr}? That would be way ahead of the pack for base VR. Tap Yes if you're serious — we believe you (probably).`;
}

export function buildFlagReason(proposedVr: number, peerMax: number): string {
  if (proposedVr > OFFICER_REVIEW_THRESHOLD) {
    return `above_${OFFICER_REVIEW_THRESHOLD}`;
  }
  return `peer_gap_${proposedVr - peerMax}`;
}
