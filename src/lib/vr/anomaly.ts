import {
  coerceInstituteLevelFromBaseVr,
  instituteLevelForBaseVr,
} from "@/lib/vr/institute-levels.shared";
import { ANOMALY_MIN_LEVEL_GAP, ANOMALY_MIN_REPORTERS } from "@/lib/vr/validation";

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

export function peerMaxInstituteLevelExcludingMember(
  rows: Array<{
    ashedMemberId: string;
    highestBaseVr: number;
    instituteLevel?: number | null;
  }>,
  excludeMemberId: string,
  seasonKey: string,
): number {
  let max = 0;
  for (const row of rows) {
    if (row.ashedMemberId === excludeMemberId) continue;
    const level =
      row.instituteLevel ??
      instituteLevelForBaseVr(seasonKey, row.highestBaseVr) ??
      coerceInstituteLevelFromBaseVr(seasonKey, row.highestBaseVr);
    if (level > max) max = level;
  }
  return max;
}

function resolveInstituteLevel(
  seasonKey: string,
  baseVr: number,
  explicitLevel?: number | null,
): number {
  return (
    explicitLevel ??
    instituteLevelForBaseVr(seasonKey, baseVr) ??
    coerceInstituteLevelFromBaseVr(seasonKey, baseVr)
  );
}

export function instituteLevelGap(input: {
  seasonKey: string;
  proposedVr: number;
  peerMaxVr: number;
  proposedLevel?: number | null;
  peerMaxLevel?: number | null;
}): number {
  const proposed = resolveInstituteLevel(
    input.seasonKey,
    input.proposedVr,
    input.proposedLevel,
  );
  const peer = resolveInstituteLevel(
    input.seasonKey,
    input.peerMaxVr,
    input.peerMaxLevel,
  );
  return proposed - peer;
}

/** True when a report is far enough above alliance peers to warrant confirm/flag. */
export function shouldAnomalyConfirm(input: {
  seasonKey: string;
  proposedVr: number;
  proposedLevel?: number | null;
  reporterCount: number;
  peerMax: number;
  peerMaxLevel?: number | null;
}): boolean {
  if (input.reporterCount < ANOMALY_MIN_REPORTERS) return false;
  if (input.peerMax <= 0) return false;

  const levelGap = instituteLevelGap({
    seasonKey: input.seasonKey,
    proposedVr: input.proposedVr,
    peerMaxVr: input.peerMax,
    proposedLevel: input.proposedLevel,
    peerMaxLevel: input.peerMaxLevel,
  });

  return levelGap >= ANOMALY_MIN_LEVEL_GAP;
}

export function buildFlagReason(
  seasonKey: string,
  proposedVr: number,
  peerMax: number,
  proposedLevel?: number | null,
  peerMaxLevel?: number | null,
): string {
  const gap = instituteLevelGap({
    seasonKey,
    proposedVr,
    peerMaxVr: peerMax,
    proposedLevel,
    peerMaxLevel,
  });
  return `peer_level_gap_${gap}`;
}

export function anomalyConfirmMessage(proposedVr: number): string {
  return `Are you *sure* your VR is ${proposedVr}? That would be way ahead of the pack for base VR. Tap Yes if you're serious — we believe you (probably).`;
}
