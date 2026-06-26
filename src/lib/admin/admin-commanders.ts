import "server-only";

import { and, count, desc, eq, sql } from "drizzle-orm";

import { buildAdminCommandersSearchWhere } from "@/lib/admin/admin-commanders-query.server";
import type { AdminCommandersQueryParams } from "@/lib/admin/admin-commanders-query.shared";
import { getDb, schema } from "@/lib/db";
import {
  listTenureHistoryByGameUid,
  resolveMemberGameUid,
} from "@/lib/members/member-tenure.server";

export type AdminCommanderListRow = {
  ashedMemberId: string;
  currentName: string;
  status: string;
  allianceRank: number | null;
  allianceId: string;
  allianceName: string;
  allianceTag: string | null;
  allianceSlug: string;
  hqUserEmail: string | null;
  hqUserDisplayName: string | null;
  discordUsername: string | null;
};

export type AdminCommanderDetail = AdminCommanderListRow & {
  previousNames: string[];
  heroPowerM: number | null;
  memberLevel: number | null;
  hqUserId: string | null;
  discordUserId: string | null;
  tenureHistory: Array<{
    allianceId: string;
    allianceTag: string | null;
    allianceName: string | null;
    ashedMemberId: string;
    joinedAt: string;
    leftAt: string | null;
  }>;
};

function memberHqUserEmail() {
  return sql<string | null>`coalesce((
    select ${schema.hqUsers.email}
    from ${schema.hqUserCommanders}
    inner join ${schema.hqUsers}
      on ${schema.hqUsers.id} = ${schema.hqUserCommanders.hqUserId}
    where ${schema.hqUserCommanders.commanderId} = ${schema.commanderAllianceMemberships.commanderId}
    order by ${schema.hqUserCommanders.isPrimary} desc, ${schema.hqUserCommanders.linkedAt} desc
    limit 1
  ), (
    select ${schema.hqUsers.email}
    from ${schema.hqMemberLinks}
    inner join ${schema.hqUsers}
      on ${schema.hqUsers.id} = ${schema.hqMemberLinks.hqUserId}
    where ${schema.hqMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.hqMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
    limit 1
  ))`;
}

function memberHqUserDisplayName() {
  return sql<string | null>`coalesce((
    select ${schema.hqUsers.displayName}
    from ${schema.hqUserCommanders}
    inner join ${schema.hqUsers}
      on ${schema.hqUsers.id} = ${schema.hqUserCommanders.hqUserId}
    where ${schema.hqUserCommanders.commanderId} = ${schema.commanderAllianceMemberships.commanderId}
    order by ${schema.hqUserCommanders.isPrimary} desc, ${schema.hqUserCommanders.linkedAt} desc
    limit 1
  ), (
    select ${schema.hqUsers.displayName}
    from ${schema.hqMemberLinks}
    inner join ${schema.hqUsers}
      on ${schema.hqUsers.id} = ${schema.hqMemberLinks.hqUserId}
    where ${schema.hqMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.hqMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
    limit 1
  ))`;
}

function memberHqUserId() {
  return sql<string | null>`coalesce((
    select ${schema.hqUserCommanders.hqUserId}
    from ${schema.hqUserCommanders}
    where ${schema.hqUserCommanders.commanderId} = ${schema.commanderAllianceMemberships.commanderId}
    order by ${schema.hqUserCommanders.isPrimary} desc, ${schema.hqUserCommanders.linkedAt} desc
    limit 1
  ), (
    select ${schema.hqMemberLinks.hqUserId}
    from ${schema.hqMemberLinks}
    where ${schema.hqMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.hqMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
    limit 1
  ))`;
}

function memberDiscordUsername() {
  return sql<string | null>`(
    select ${schema.discordMemberLinks.discordUsername}
    from ${schema.discordMemberLinks}
    where ${schema.discordMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.discordMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
    order by ${schema.discordMemberLinks.linkedAt} desc
    limit 1
  )`;
}

function memberDiscordUserId() {
  return sql<string | null>`(
    select ${schema.discordMemberLinks.discordUserId}
    from ${schema.discordMemberLinks}
    where ${schema.discordMemberLinks.allianceId} = ${schema.allianceMembers.allianceId}
      and ${schema.discordMemberLinks.ashedMemberId} = ${schema.allianceMembers.ashedMemberId}
    order by ${schema.discordMemberLinks.linkedAt} desc
    limit 1
  )`;
}

export async function loadAdminCommandersMeta(): Promise<{
  alliances: Array<{ id: string; name: string; slug: string; tag: string | null }>;
}> {
  const db = getDb();
  const alliances = await db
    .select({
      id: schema.alliances.id,
      name: schema.alliances.name,
      slug: schema.alliances.slug,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .orderBy(schema.alliances.name);
  return { alliances };
}

export async function searchAdminCommanders(params: {
  q?: string;
  page: number;
  limit: number;
  allianceId?: string;
  status?: string;
}): Promise<{
  commanders: AdminCommanderListRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const where = buildAdminCommandersSearchWhere({
    q: params.q,
    allianceId: params.allianceId,
    status: params.status,
  });

  const baseQuery = db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: sql<string>`coalesce(${schema.allianceMembers.currentName}, ${schema.commanders.primaryName})`,
      status: sql<string>`coalesce(${schema.allianceMembers.status}, ${schema.commanderAllianceMemberships.status})`,
      allianceRank: sql<number | null>`coalesce(${schema.allianceMembers.allianceRank}, ${schema.commanderAllianceMemberships.allianceRank})`,
      allianceId: schema.allianceMembers.allianceId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
      hqUserEmail: memberHqUserEmail(),
      hqUserDisplayName: memberHqUserDisplayName(),
      discordUsername: memberDiscordUsername(),
    })
    .from(schema.allianceMembers)
    .innerJoin(
      schema.alliances,
      eq(schema.allianceMembers.allianceId, schema.alliances.id),
    )
    .leftJoin(
      schema.commanderAllianceMemberships,
      and(
        eq(
          schema.commanderAllianceMemberships.allianceId,
          schema.allianceMembers.allianceId,
        ),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          schema.allianceMembers.ashedMemberId,
        ),
      ),
    )
    .leftJoin(
      schema.commanders,
      eq(schema.commanderAllianceMemberships.commanderId, schema.commanders.id),
    );

  const filtered = where ? baseQuery.where(where) : baseQuery;
  const offset = (params.page - 1) * params.limit;

  const [totalRow] = await db
    .select({ total: count() })
    .from(schema.allianceMembers)
    .innerJoin(
      schema.alliances,
      eq(schema.allianceMembers.allianceId, schema.alliances.id),
    )
    .leftJoin(
      schema.commanderAllianceMemberships,
      and(
        eq(
          schema.commanderAllianceMemberships.allianceId,
          schema.allianceMembers.allianceId,
        ),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          schema.allianceMembers.ashedMemberId,
        ),
      ),
    )
    .leftJoin(
      schema.commanders,
      eq(schema.commanderAllianceMemberships.commanderId, schema.commanders.id),
    )
    .where(where ?? undefined);

  const rows = await filtered
    .orderBy(desc(schema.allianceMembers.updatedAt))
    .limit(params.limit)
    .offset(offset);

  return {
    commanders: rows,
    total: Number(totalRow?.total ?? 0),
    page: params.page,
    pageSize: params.limit,
  };
}

export async function loadAdminCommanderDetail(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<AdminCommanderDetail | null> {
  const db = getDb();
  const [member] = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: sql<string>`coalesce(${schema.allianceMembers.currentName}, ${schema.commanders.primaryName})`,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
      status: sql<string>`coalesce(${schema.allianceMembers.status}, ${schema.commanderAllianceMemberships.status})`,
      allianceRank: sql<number | null>`coalesce(${schema.allianceMembers.allianceRank}, ${schema.commanderAllianceMemberships.allianceRank})`,
      gameUid: sql<string | null>`coalesce(${schema.allianceMembers.gameUid}, ${schema.commanders.gameUid})`,
      heroPowerM: sql<number | null>`coalesce(${schema.allianceMembers.heroPowerM}, ${schema.commanders.heroPowerM})`,
      memberLevel: sql<number | null>`coalesce(${schema.allianceMembers.memberLevel}, ${schema.commanders.memberLevel})`,
      allianceId: schema.allianceMembers.allianceId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
      hqUserId: memberHqUserId(),
      hqUserEmail: memberHqUserEmail(),
      hqUserDisplayName: memberHqUserDisplayName(),
      discordUserId: memberDiscordUserId(),
      discordUsername: memberDiscordUsername(),
    })
    .from(schema.allianceMembers)
    .innerJoin(
      schema.alliances,
      eq(schema.allianceMembers.allianceId, schema.alliances.id),
    )
    .leftJoin(
      schema.commanderAllianceMemberships,
      and(
        eq(
          schema.commanderAllianceMemberships.allianceId,
          schema.allianceMembers.allianceId,
        ),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          schema.allianceMembers.ashedMemberId,
        ),
      ),
    )
    .leftJoin(
      schema.commanders,
      eq(schema.commanderAllianceMemberships.commanderId, schema.commanders.id),
    )
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!member) return null;

  const gameUid =
    member.gameUid?.trim() ??
    (await resolveMemberGameUid(input.allianceId, input.ashedMemberId));
  const tenureRows = gameUid
    ? await listTenureHistoryByGameUid(gameUid)
    : [];

  return {
    ashedMemberId: member.ashedMemberId,
    currentName: member.currentName,
    previousNames: member.previousNamesJson ?? [],
    status: member.status,
    allianceRank: member.allianceRank,
    heroPowerM: member.heroPowerM,
    memberLevel: member.memberLevel,
    allianceId: member.allianceId,
    allianceName: member.allianceName,
    allianceTag: member.allianceTag,
    allianceSlug: member.allianceSlug,
    hqUserId: member.hqUserId,
    hqUserEmail: member.hqUserEmail,
    hqUserDisplayName: member.hqUserDisplayName,
    discordUserId: member.discordUserId,
    discordUsername: member.discordUsername,
    tenureHistory: tenureRows.map((row) => ({
      allianceId: row.allianceId,
      allianceTag: row.allianceTag,
      allianceName: row.allianceName,
      ashedMemberId: row.ashedMemberId,
      joinedAt: row.joinedAt.toISOString(),
      leftAt: row.leftAt?.toISOString() ?? null,
    })),
  };
}

export async function resolveAdminCommandersRequest(
  params: AdminCommandersQueryParams,
) {
  if (params.ashedMemberId && params.detailAllianceId) {
    const commander = await loadAdminCommanderDetail({
      allianceId: params.detailAllianceId,
      ashedMemberId: params.ashedMemberId,
    });
    return { commander };
  }

  const [search, meta] = await Promise.all([
    searchAdminCommanders({
      q: params.q,
      page: params.page,
      limit: params.limit,
      allianceId: params.allianceId,
      status: params.status,
    }),
    loadAdminCommandersMeta(),
  ]);

  return { ...search, alliances: meta.alliances };
}
