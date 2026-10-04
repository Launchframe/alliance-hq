import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import {
  buildMemberIndex,
  matchMemberName,
  MEMBER_FUZZY_AUTO_MATCH_MIN,
} from "@/lib/video/member-matcher";

export type OfficerActionItemAssigneeMatch = {
  allianceMemberId: string | null;
  ashedMemberId: string | null;
  memberName: string | null;
  matchMethod: "exact" | "previous_name" | "fuzzy" | "none";
  confidence: number;
};

async function loadAllianceRosterMembers(allianceId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    );
  return rows.map(allianceMemberRowToAshedMember);
}

export async function matchOfficerActionItemAssignee(input: {
  allianceId: string;
  assigneeName: string | null | undefined;
}): Promise<OfficerActionItemAssigneeMatch> {
  const name = input.assigneeName?.trim();
  if (!name) {
    return {
      allianceMemberId: null,
      ashedMemberId: null,
      memberName: null,
      matchMethod: "none",
      confidence: 0,
    };
  }

  const members = await loadAllianceRosterMembers(input.allianceId);
  if (members.length === 0) {
    return {
      allianceMemberId: null,
      ashedMemberId: null,
      memberName: null,
      matchMethod: "none",
      confidence: 0,
    };
  }

  const match = matchMemberName(name, buildMemberIndex(members));
  if (
    !match.memberId ||
    (match.matchMethod === "fuzzy" &&
      match.confidence < MEMBER_FUZZY_AUTO_MATCH_MIN)
  ) {
    return {
      allianceMemberId: null,
      ashedMemberId: null,
      memberName: null,
      matchMethod: "none",
      confidence: match.confidence,
    };
  }

  const db = getDb();
  const [memberRow] = await db
    .select({ id: schema.allianceMembers.id })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, match.memberId),
      ),
    )
    .limit(1);

  return {
    allianceMemberId: memberRow?.id ?? null,
    ashedMemberId: match.memberId,
    memberName: match.memberName,
    matchMethod: match.matchMethod,
    confidence: match.confidence,
  };
}
