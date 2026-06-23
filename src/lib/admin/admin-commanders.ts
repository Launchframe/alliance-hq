import "server-only";

import { and, count, desc, eq } from "drizzle-orm";

import { buildAdminCommandersSearchWhere } from "@/lib/admin/admin-commanders-query.server";
import type { AdminCommandersQueryParams } from "@/lib/admin/admin-commanders-query.shared";
import { getDb, schema } from "@/lib/db";
import { listTenureHistoryByGameUid } from "@/lib/members/member-tenure.server";

export type AdminCommanderListRow = {
  ashedMemberId: string;
  currentName: string;
  status: string;
  allianceRank: number | null;
  gameUid: string | null;
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
      currentName: schema.allianceMembers.currentName,
      status: schema.allianceMembers.status,
      allianceRank: schema.allianceMembers.allianceRank,
      gameUid: schema.allianceMembers.gameUid,
      allianceId: schema.allianceMembers.allianceId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
      hqUserEmail: schema.hqUsers.email,
      hqUserDisplayName: schema.hqUsers.displayName,
      discordUsername: schema.discordMemberLinks.discordUsername,
    })
    .from(schema.allianceMembers)
    .innerJoin(
      schema.alliances,
      eq(schema.allianceMembers.allianceId, schema.alliances.id),
    )
    .leftJoin(
      schema.hqMemberLinks,
      and(
        eq(schema.hqMemberLinks.allianceId, schema.allianceMembers.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, schema.allianceMembers.ashedMemberId),
      ),
    )
    .leftJoin(
      schema.hqUsers,
      eq(schema.hqMemberLinks.hqUserId, schema.hqUsers.id),
    )
    .leftJoin(
      schema.discordMemberLinks,
      and(
        eq(schema.discordMemberLinks.allianceId, schema.allianceMembers.allianceId),
        eq(
          schema.discordMemberLinks.ashedMemberId,
          schema.allianceMembers.ashedMemberId,
        ),
      ),
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
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
      status: schema.allianceMembers.status,
      allianceRank: schema.allianceMembers.allianceRank,
      gameUid: schema.allianceMembers.gameUid,
      heroPowerM: schema.allianceMembers.heroPowerM,
      memberLevel: schema.allianceMembers.memberLevel,
      allianceId: schema.allianceMembers.allianceId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
      hqUserId: schema.hqMemberLinks.hqUserId,
      hqUserEmail: schema.hqUsers.email,
      hqUserDisplayName: schema.hqUsers.displayName,
      discordUserId: schema.discordMemberLinks.discordUserId,
      discordUsername: schema.discordMemberLinks.discordUsername,
    })
    .from(schema.allianceMembers)
    .innerJoin(
      schema.alliances,
      eq(schema.allianceMembers.allianceId, schema.alliances.id),
    )
    .leftJoin(
      schema.hqMemberLinks,
      and(
        eq(schema.hqMemberLinks.allianceId, schema.allianceMembers.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, schema.allianceMembers.ashedMemberId),
      ),
    )
    .leftJoin(
      schema.hqUsers,
      eq(schema.hqMemberLinks.hqUserId, schema.hqUsers.id),
    )
    .leftJoin(
      schema.discordMemberLinks,
      and(
        eq(schema.discordMemberLinks.allianceId, schema.allianceMembers.allianceId),
        eq(
          schema.discordMemberLinks.ashedMemberId,
          schema.allianceMembers.ashedMemberId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!member) return null;

  const gameUid = member.gameUid?.trim() ?? null;
  const tenureRows = gameUid ? await listTenureHistoryByGameUid(gameUid) : [];

  return {
    ashedMemberId: member.ashedMemberId,
    currentName: member.currentName,
    previousNames: member.previousNamesJson ?? [],
    status: member.status,
    allianceRank: member.allianceRank,
    gameUid,
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
