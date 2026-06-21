import "server-only";

import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { schema } from "@/lib/db";

import { escapeLikePrefix } from "./audit-query";
import type {
  AdminAlliancesOrder,
  AdminAlliancesQueryParams,
} from "./admin-alliances-query.shared";

const LIKE_ESCAPE = "\\";

export type AdminAlliancesDrizzleQuery = {
  where?: SQL;
  orderBy: SQL | typeof schema.alliances.name | typeof schema.alliances.rolesSyncedAt;
  order: AdminAlliancesOrder;
  limit: number;
  offset: number;
};

function memberCountOrderExpr(): SQL {
  return sql`coalesce((
    select count(*)::int from ${schema.allianceMemberships}
    where ${schema.allianceMemberships.allianceId} = ${schema.alliances.id}
  ), 0)`;
}

function buildSearchWhere(q: string | undefined): SQL | undefined {
  const trimmed = q?.trim();
  if (!trimmed) {
    return undefined;
  }

  const pattern = `%${escapeLikePrefix(trimmed)}%`;
  return or(
    sql`${schema.alliances.name} ilike ${pattern} escape ${LIKE_ESCAPE}`,
    sql`${schema.alliances.slug} ilike ${pattern} escape ${LIKE_ESCAPE}`,
    sql`${schema.alliances.tag} ilike ${pattern} escape ${LIKE_ESCAPE}`,
    sql`${schema.alliances.ashedAllianceId} ilike ${pattern} escape ${LIKE_ESCAPE}`,
    sql`${schema.alliances.ownerEmail} ilike ${pattern} escape ${LIKE_ESCAPE}`,
  );
}

export function buildAdminAlliancesQuery(
  params: AdminAlliancesQueryParams,
): AdminAlliancesDrizzleQuery {
  const conditions: SQL[] = [];

  const searchWhere = buildSearchWhere(params.q);
  if (searchWhere) {
    conditions.push(searchWhere);
  }

  if (params.operatingMode === "native") {
    conditions.push(eq(schema.alliances.operatingMode, "native"));
  } else if (params.operatingMode === "ashed") {
    conditions.push(eq(schema.alliances.operatingMode, "ashed"));
  }

  const where =
    conditions.length > 0 ? and(...conditions) : undefined;

  let orderBy: AdminAlliancesDrizzleQuery["orderBy"];
  switch (params.sort) {
    case "memberCount":
      orderBy = memberCountOrderExpr();
      break;
    case "rolesSyncedAt":
      orderBy = schema.alliances.rolesSyncedAt;
      break;
    case "name":
    default:
      orderBy = schema.alliances.name;
      break;
  }

  return {
    where,
    orderBy,
    order: params.order,
    limit: params.limit,
    offset: params.offset,
  };
}