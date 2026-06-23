import "server-only";

import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { escapeLikePrefix } from "@/lib/admin/audit-query";
import { schema } from "@/lib/db";

const LIKE_ESCAPE = "\\";

export type AdminUsersSearchFilters = {
  q?: string;
  allianceId?: string;
  platformMaintainersOnly?: boolean;
};

function memberLinkExists(condition: SQL): SQL {
  return sql`exists (
    select 1 from ${schema.hqMemberLinks}
    where ${schema.hqMemberLinks.hqUserId} = ${schema.hqUsers.id}
      and (${condition})
  )`;
}

function membershipExists(condition: SQL): SQL {
  return sql`exists (
    select 1 from ${schema.allianceMemberships}
    where ${schema.allianceMemberships.hqUserId} = ${schema.hqUsers.id}
      and (${condition})
  )`;
}

export function buildAdminUsersSearchWhere(
  filters: AdminUsersSearchFilters,
): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.allianceId) {
    conditions.push(
      or(
        membershipExists(
          eq(schema.allianceMemberships.allianceId, filters.allianceId),
        ),
        memberLinkExists(
          eq(schema.hqMemberLinks.allianceId, filters.allianceId),
        ),
      )!,
    );
  }

  if (filters.platformMaintainersOnly) {
    conditions.push(eq(schema.hqUsers.isPlatformMaintainer, 1));
  }

  const trimmed = filters.q?.trim();
  if (trimmed) {
    const pattern = `%${escapeLikePrefix(trimmed)}%`;
    const textMatches = or(
      sql`${schema.hqUsers.email} ilike ${pattern} escape ${LIKE_ESCAPE}`,
      sql`coalesce(${schema.hqUsers.displayName}, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      memberLinkExists(
        sql`coalesce(${schema.hqMemberLinks.memberDisplayName}, '') ilike ${pattern} escape ${LIKE_ESCAPE}`,
      ),
      memberLinkExists(
        sql`${schema.hqMemberLinks.gameUid} ilike ${pattern} escape ${LIKE_ESCAPE}`,
      ),
    );

    const exactId = trimmed.length >= 8 && trimmed.length <= 32;
    if (exactId) {
      conditions.push(
        or(
          eq(schema.hqUsers.id, trimmed),
          memberLinkExists(eq(schema.hqMemberLinks.id, trimmed)),
          memberLinkExists(eq(schema.hqMemberLinks.ashedMemberId, trimmed)),
          memberLinkExists(eq(schema.hqMemberLinks.gameUid, trimmed)),
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
