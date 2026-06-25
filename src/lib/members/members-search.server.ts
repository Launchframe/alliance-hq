import "server-only";

import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { escapeLikePrefix } from "@/lib/admin/audit-query";
import { getDb, schema } from "@/lib/db";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.server";
import type { AshedMember } from "@/lib/video/member-matcher";

const LIKE_ESCAPE = "\\";
const MEMBER_SEARCH_LIMIT = 200;

function discordLinkExists(condition: SQL): SQL {
  return sql`exists (
    select 1 from ${schema.discordMemberLinks}
    where ${schema.discordMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.discordMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
      and (${condition})
  )`;
}

export function buildMembersSearchWhere(
  allianceId: string,
  q?: string,
): SQL | undefined {
  const conditions: SQL[] = [eq(schema.allianceMembers.allianceId, allianceId)];

  const trimmed = q?.trim();
  if (trimmed) {
    const pattern = `%${escapeLikePrefix(trimmed)}%`;
    const textMatches = or(
      sql`${schema.allianceMembers.currentName} ilike ${pattern} escape ${LIKE_ESCAPE}`,
      sql`coalesce(${schema.allianceMembers.gameUid}, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      sql`coalesce(${schema.allianceMembers.previousNamesJson}::text, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      discordLinkExists(
        sql`coalesce(${schema.discordMemberLinks.discordUsername}, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      ),
    );

    if (trimmed.length >= 4) {
      conditions.push(
        or(
          eq(schema.allianceMembers.ashedMemberId, trimmed),
          eq(schema.allianceMembers.gameUid, trimmed),
          textMatches,
        )!,
      );
    } else if (textMatches) {
      conditions.push(textMatches);
    }
  }

  return and(...conditions);
}

export async function searchAllianceMembers(input: {
  allianceId: string;
  q?: string;
  includeFormer?: boolean;
}): Promise<AshedMember[]> {
  const db = getDb();
  const where = buildMembersSearchWhere(input.allianceId, input.q);

  const rows = await db
    .select()
    .from(schema.allianceMembers)
    .where(where)
    .orderBy(schema.allianceMembers.currentName)
    .limit(MEMBER_SEARCH_LIMIT);

  const filtered = input.includeFormer
    ? rows
    : rows.filter((row) => row.status !== "former");

  return filtered.map((row) => allianceMemberRowToAshedMember(row));
}

export async function listAllianceMembersFromDb(
  allianceId: string,
  includeFormer = true,
): Promise<AshedMember[]> {
  return searchAllianceMembers({
    allianceId,
    includeFormer,
  });
}
