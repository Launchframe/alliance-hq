import { ANOMALY_GAP, ANOMALY_MIN_REPORTERS } from "@/lib/vr/validation";

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

/** True when a report is far enough above alliance peers to warrant confirm/flag. */
export function shouldAnomalyConfirm(input: {
  proposedVr: number;
  reporterCount: number;
  peerMax: number;
}): boolean {
  if (input.reporterCount < ANOMALY_MIN_REPORTERS) return false;
  if (input.peerMax <= 0) return false;
  return input.proposedVr >= input.peerMax + ANOMALY_GAP;
}

export function buildFlagReason(proposedVr: number, peerMax: number): string {
  return `peer_gap_${proposedVr - peerMax}`;
}

export function anomalyConfirmMessage(proposedVr: number): string {
  return `Are you *sure* your VR is ${proposedVr}? That would be way ahead of the pack for base VR. Tap Yes if you're serious — we believe you (probably).`;
}
