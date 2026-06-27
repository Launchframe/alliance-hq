import type { AshedMemberProfession } from "@/lib/members/ashed-member-record";
import {
  buildMemberIndex,
  matchMemberName,
  type AshedMember,
} from "@/lib/video/member-matcher";
import { parsePowerLevelString } from "@/lib/video/roster-extract";

const VALID_PROFESSIONS = new Set<string>(["Engineer", "War Leader"]);

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

export const ROSTER_NAME_MATCH_CONFIDENCE_MIN = 0.6;

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

export function isRosterRowNameMismatch(row: {
  memberId: string | null;
  matchConfidence: number | null;
  matchMethod?: string | null;
  deleted: number;
}): boolean {
  if (row.deleted === 1) return false;
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
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isRosterRowNameMismatch(row)) {
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

    if (!memberId && index) {
      const match = matchMemberName(row.ocrName, index, { allianceTag });
      if (match.memberId) {
        memberId = match.memberId;
        memberName = match.memberName;
        matchConfidence = match.confidence;
      }
    }

    const level =
      row.memberLevel != null && row.memberLevel >= 1
        ? Math.round(row.memberLevel)
        : null;

    let profession: string | null = null;
    if (
      row.edited === 1 &&
      row.profession &&
      VALID_PROFESSIONS.has(row.profession)
    ) {
      profession = row.profession as AshedMemberProfession;
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
      memberLevel: level,
      profession,
      frameIndex: row.frameIndex,
      memberId,
      memberName,
      matchConfidence,
      matchMethod: row.matchMethod ?? null,
      deleted: row.deleted,
    };
  });
}
