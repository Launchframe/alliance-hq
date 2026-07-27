import {
  buildMemberIndex,
  matchMemberName,
  MEMBER_FUZZY_AUTO_MATCH_MIN,
  type AshedMember,
} from "@/lib/video/member-matcher";
import { parsePowerLevelString } from "@/lib/video/roster-extract";

export type ParsedRowLike = {
  id: string;
  ocrName: string;
  allianceRank?: number | null;
  powerLevel?: string | null;
  memberLevel?: number | null;
  profession?: string | null;
  frameIndex?: number | null;
  memberId: string | null;
  memberName: string | null;
  matchConfidence: number | null;
  matchMethod?: string | null;
  deleted: number;
  edited?: number;
};

/** Same floor as member auto-match / history import. */
export const ROSTER_NAME_MATCH_CONFIDENCE_MIN = MEMBER_FUZZY_AUTO_MATCH_MIN;

export type RosterReviewRowShape = {
  id: string;
  ocrName: string;
  allianceRank: number | null;
  heroPowerM: number | null;
  memberLevel: number | null;
  profession: string | null;
  frameIndex?: number | null;
  memberId: string | null;
  memberName: string | null;
  matchConfidence: number | null;
  matchMethod?: string | null;
  deleted: number;
};

export function isRosterRowNameMismatch(
  row: {
    memberId: string | null;
    matchConfidence: number | null;
    matchMethod?: string | null;
    deleted: number;
  },
  options?: { existingMemberCount?: number },
): boolean {
  if (row.deleted === 1) return false;
  // Brand-new / empty HQ roster: null memberId means "Create new", not a mismatch.
  if ((options?.existingMemberCount ?? 1) <= 0) {
    if (!row.memberId) return false;
  }
  if (!row.memberId) return true;
  if (row.matchMethod === "none") return true;
  if (row.matchConfidence == null || row.matchConfidence < ROSTER_NAME_MATCH_CONFIDENCE_MIN) {
    return true;
  }
  return false;
}

export function findUnmatchedRosterRowIds(
  rows: Array<{
    id: string;
    memberId: string | null;
    matchConfidence: number | null;
    matchMethod?: string | null;
    deleted: number;
  }>,
  options?: { existingMemberCount?: number },
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isRosterRowNameMismatch(row, options)) {
      ids.add(row.id);
    }
  }
  return ids;
}

export function formatHeroPowerMForStorage(
  heroPowerM: number | null | undefined,
): string | null {
  if (heroPowerM == null || !Number.isFinite(heroPowerM)) {
    return null;
  }
  return `${heroPowerM}M`;
}

export function parsedRowsToRosterReviewRows(
  rows: ParsedRowLike[],
  members: AshedMember[],
  allianceTag: string,
): RosterReviewRowShape[] {
  const index = members.length > 0 ? buildMemberIndex(members) : null;

  return rows.map((row) => {
    const { heroPowerM } = parsePowerLevelString(row.powerLevel ?? null);
    let memberId = row.memberId;
    let memberName = row.memberName;
    let matchConfidence = row.matchConfidence;
    let matchMethod = row.matchMethod ?? null;

    if (!memberId && index) {
      const match = matchMemberName(row.ocrName, index, { allianceTag });
      if (match.memberId) {
        memberId = match.memberId;
        memberName = match.memberName;
        matchConfidence = match.confidence;
        matchMethod = match.matchMethod;
      }
    }

    return {
      id: row.id,
      ocrName: row.ocrName,
      allianceRank:
        row.allianceRank != null &&
        row.allianceRank >= 1 &&
        row.allianceRank <= 5
          ? row.allianceRank
          : null,
      heroPowerM,
      memberLevel:
        row.memberLevel != null && Number.isFinite(row.memberLevel)
          ? row.memberLevel
          : null,
      profession: null,
      frameIndex: row.frameIndex,
      memberId,
      memberName,
      matchConfidence,
      matchMethod,
      deleted: row.deleted,
    };
  });
}
