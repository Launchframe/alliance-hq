import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { LinkedCommanderRow } from "@/lib/members/linked-commanders.shared";

export type { LinkedCommanderRow };

export async function listLinkedCommandersForHqUser(
  hqUserId: string,
): Promise<LinkedCommanderRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      allianceId: schema.hqMemberLinks.allianceId,
      allianceTag: schema.alliances.tag,
      allianceName: schema.alliances.name,
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      rosterName: schema.allianceMembers.currentName,
      linkName: schema.hqMemberLinks.memberDisplayName,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinks.allianceId),
    )
    .leftJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, schema.hqMemberLinks.allianceId),
        eq(
          schema.allianceMembers.ashedMemberId,
          schema.hqMemberLinks.ashedMemberId,
        ),
      ),
    )
    .where(eq(schema.hqMemberLinks.hqUserId, hqUserId))
    .orderBy(asc(schema.alliances.tag), asc(schema.allianceMembers.currentName));

  return rows.map((row) => ({
    allianceId: row.allianceId,
    allianceTag: row.allianceTag,
    allianceName: row.allianceName,
    ashedMemberId: row.ashedMemberId,
    memberDisplayName: row.rosterName?.trim() || row.linkName,
  }));
}
