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
  deleted: number;
};

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
      deleted: row.deleted,
    };
  });
}
