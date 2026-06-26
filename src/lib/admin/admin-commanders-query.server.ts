import "server-only";

import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { escapeLikePrefix } from "@/lib/admin/audit-query";
import { schema } from "@/lib/db";

const LIKE_ESCAPE = "\\";

export type AdminCommandersSearchFilters = {
  q?: string;
  allianceId?: string;
  status?: string;
};

function hqLinkExists(condition: SQL): SQL {
  return sql`exists (
    select 1 from ${schema.hqMemberLinks}
    where ${schema.hqMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.hqMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
      and (${condition})
  )`;
}

function hqUserEmailMatches(pattern: string): SQL {
  return sql`exists (
    select 1 from ${schema.hqMemberLinks}
    inner join ${schema.hqUsers}
      on ${schema.hqUsers.id} = ${schema.hqMemberLinks.hqUserId}
    where ${schema.hqMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.hqMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
      and ${schema.hqUsers.email} ilike ${pattern} escape ${LIKE_ESCAPE}
  )`;
}

function discordLinkExists(condition: SQL): SQL {
  return sql`exists (
    select 1 from ${schema.discordMemberLinks}
    where ${schema.discordMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.discordMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
      and (${condition})
  )`;
}

export function buildAdminCommandersSearchWhere(
  filters: AdminCommandersSearchFilters,
): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.allianceId) {
    conditions.push(eq(schema.allianceMembers.allianceId, filters.allianceId));
  }

  if (filters.status) {
    conditions.push(eq(schema.allianceMembers.status, filters.status));
  }

  const trimmed = filters.q?.trim();
  if (trimmed) {
    const pattern = `%${escapeLikePrefix(trimmed)}%`;
    const textMatches = or(
      sql`${schema.allianceMembers.currentName} ilike ${pattern} escape ${LIKE_ESCAPE}`,
      sql`coalesce(${schema.allianceMembers.gameUid}, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      sql`coalesce(${schema.allianceMembers.previousNamesJson}::text, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      sql`coalesce(${schema.alliances.tag}, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      hqLinkExists(
        sql`coalesce(${schema.hqMemberLinks.memberDisplayName}, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      ),
      hqUserEmailMatches(pattern),
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

  if (conditions.length === 0) {
    return undefined;
  }

  return and(...conditions);
}
