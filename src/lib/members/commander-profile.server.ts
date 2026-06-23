import "server-only";

import { and, desc, eq, or } from "drizzle-orm";

import { forwardJson } from "@/lib/bff/session";
import { getDb, schema } from "@/lib/db";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import {
  assertCommanderReadAccess,
  loadAllianceCommander,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";
import { listTenureHistoryByGameUid } from "@/lib/members/member-tenure.server";
import {
  formatMemberRankDisplay,
  parseAshedMemberAllianceRank,
} from "@/lib/members/alliance-rank";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import { sessionHasPermission } from "@/lib/rbac/context";
import { getAshedConnection } from "@/lib/session";

type AshedRecord = Record<string, unknown>;

export type CommanderProfilePayload = {
  member: {
    ashedMemberId: string;
    currentName: string;
    previousNames: string[];
    status: string;
    rankLabel: string;
    titleLabel: string;
    heroPowerM: number | null;
    memberLevel: number | null;
    gameUid: string | null;
  };
  alliance: {
    id: string;
    tag: string | null;
    name: string | null;
    slug: string;
  };
  hqUser: {
    id: string;
    displayName: string | null;
    email: string | null;
  } | null;
  discordLinks: Array<{
    discordUserId: string;
    discordUsername: string | null;
    linkedAt: string;
  }>;
  tenureHistory: Array<{
    allianceId: string;
    allianceTag: string | null;
    allianceName: string | null;
    ashedMemberId: string;
    joinedAt: string;
    leftAt: string | null;
    isCurrent: boolean;
  }>;
  rankTimeline: Array<{
    id: string;
    allianceRank: number;
    allianceRankTitle: string | null;
    effectiveDate: string;
    source: string;
  }>;
  vrHistory: Array<{
    seasonKey: string;
    highestBaseVr: number;
    updatedAt: string;
  }>;
  eventScores: Array<{
    eventId: string;
    eventName: string;
    boardKey: string | null;
    score: number | null;
    rank: number | null;
    updatedAt: string;
  }>;
  commendations: AshedRecord[];
  violations: AshedRecord[];
  trainHighlights: Array<{
    date: string;
    role: "conductor" | "vip" | "substitute";
    lockedAt: string | null;
  }>;
  operatingMode: "ashed" | "native";
};

async function fetchAshedEntityList(
  connection: Awaited<ReturnType<typeof getAshedConnection>>,
  entity: string,
  memberId: string,
): Promise<AshedRecord[]> {
  if (!connection) return [];

  try {
    const query = new URLSearchParams({ member_id: memberId });
    const upstream = await forwardJson(
      connection,
      `/entities/${entity}?${query.toString()}`,
      { method: "GET" },
    );
    if (!upstream.ok) return [];
    const body = (await upstream.json()) as unknown;
    if (Array.isArray(body)) return body as AshedRecord[];
    if (body && typeof body === "object" && Array.isArray((body as AshedRecord).items)) {
      return (body as AshedRecord).items as AshedRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

function parseEventMetadata(metadata: unknown): {
  score: number | null;
  rank: number | null;
} {
  if (!metadata || typeof metadata !== "object") {
    return { score: null, rank: null };
  }
  const row = metadata as Record<string, unknown>;
  const scoreRaw = row.score ?? row.total_score ?? row.points;
  const rankRaw = row.rank ?? row.placement;
  return {
    score: typeof scoreRaw === "number" ? scoreRaw : null,
    rank: typeof rankRaw === "number" ? rankRaw : null,
  };
}

export async function loadCommanderProfile(
  sessionId: string,
  ashedMemberId: string,
): Promise<CommanderProfilePayload | null> {
  const { allianceId } = await resolveCommanderSessionContext(sessionId);
  await assertCommanderReadAccess(sessionId, allianceId);

  const memberRow = await loadAllianceCommander(allianceId, ashedMemberId);
  if (!memberRow) return null;

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      slug: schema.alliances.slug,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!alliance) return null;

  const operatingMode = await getAllianceOperatingMode(allianceId);
  const canSeeEmail = await sessionHasPermission(sessionId, "members:write");

  const [hqLink] = await db
    .select({
      hqUserId: schema.hqMemberLinks.hqUserId,
      linkedAt: schema.hqMemberLinks.linkedAt,
      gameUid: schema.hqMemberLinks.gameUid,
    })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  let hqUser: CommanderProfilePayload["hqUser"] = null;
  if (hqLink) {
    const [user] = await db
      .select({
        id: schema.hqUsers.id,
        displayName: schema.hqUsers.displayName,
        email: schema.hqUsers.email,
      })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, hqLink.hqUserId))
      .limit(1);
    if (user) {
      hqUser = {
        id: user.id,
        displayName: user.displayName,
        email: canSeeEmail ? user.email : null,
      };
    }
  }

  const discordLinks = await db
    .select({
      discordUserId: schema.discordMemberLinks.discordUserId,
      discordUsername: schema.discordMemberLinks.discordUsername,
      linkedAt: schema.discordMemberLinks.linkedAt,
      gameUid: schema.discordMemberLinks.gameUid,
    })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, allianceId),
        eq(schema.discordMemberLinks.ashedMemberId, ashedMemberId),
      ),
    );

  const gameUid =
    memberRow.gameUid?.trim() ??
    hqLink?.gameUid?.trim() ??
    discordLinks[0]?.gameUid?.trim() ??
    null;

  const tenureRows = gameUid
    ? await listTenureHistoryByGameUid(gameUid)
    : [];

  const rankEvents = await db
    .select()
    .from(schema.memberAllianceRankEvents)
    .where(
      and(
        eq(schema.memberAllianceRankEvents.allianceId, allianceId),
        eq(schema.memberAllianceRankEvents.ashedMemberId, ashedMemberId),
      ),
    )
    .orderBy(desc(schema.memberAllianceRankEvents.effectiveDate));

  const vrRows = await db
    .select()
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.ashedMemberId, ashedMemberId),
      ),
    )
    .orderBy(desc(schema.memberSeasonVr.seasonKey));

  const eventScoreRows = await db
    .select({
      eventId: schema.hqEvents.id,
      eventName: schema.hqEvents.name,
      metadata: schema.hqEventMembers.metadata,
      updatedAt: schema.hqEventMembers.updatedAt,
    })
    .from(schema.hqEventMembers)
    .innerJoin(
      schema.hqEvents,
      eq(schema.hqEventMembers.hqEventId, schema.hqEvents.id),
    )
    .where(
      and(
        eq(schema.hqEvents.allianceId, allianceId),
        eq(schema.hqEventMembers.memberId, ashedMemberId),
      ),
    )
    .orderBy(desc(schema.hqEventMembers.updatedAt))
    .limit(20);

  const trainRows = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.allianceId, allianceId),
        or(
          eq(schema.trainConductorRecords.conductorMemberId, ashedMemberId),
          eq(schema.trainConductorRecords.vipMemberId, ashedMemberId),
          eq(schema.trainConductorRecords.substituteForMemberId, ashedMemberId),
        ),
      ),
    )
    .orderBy(desc(schema.trainConductorRecords.date))
    .limit(12);

  const connection =
    operatingMode === "ashed" ? await getAshedConnection(sessionId) : null;
  const [commendations, violations] = connection
    ? await Promise.all([
        fetchAshedEntityList(connection, "Commendation", ashedMemberId),
        fetchAshedEntityList(connection, "Violation", ashedMemberId),
      ])
    : [[], []];

  const ashedMember = allianceMemberRowToAshedMember(memberRow);
  const { rankLabel, titleLabel } = formatMemberRankDisplay(
    parseAshedMemberAllianceRank(ashedMember),
    "—",
  );

  return {
    member: {
      ashedMemberId,
      currentName: memberRow.currentName,
      previousNames: memberRow.previousNamesJson ?? [],
      status: memberRow.status,
      rankLabel,
      titleLabel,
      heroPowerM: memberRow.heroPowerM,
      memberLevel: memberRow.memberLevel,
      gameUid,
    },
    alliance,
    hqUser,
    discordLinks: discordLinks.map((link) => ({
      discordUserId: link.discordUserId,
      discordUsername: link.discordUsername,
      linkedAt: link.linkedAt.toISOString(),
    })),
    tenureHistory: tenureRows.map((row) => ({
      allianceId: row.allianceId,
      allianceTag: row.allianceTag,
      allianceName: row.allianceName,
      ashedMemberId: row.ashedMemberId,
      joinedAt: row.joinedAt.toISOString(),
      leftAt: row.leftAt?.toISOString() ?? null,
      isCurrent: row.leftAt == null,
    })),
    rankTimeline: rankEvents.map((event) => ({
      id: event.id,
      allianceRank: event.allianceRank,
      allianceRankTitle: event.allianceRankTitle,
      effectiveDate: event.effectiveDate,
      source: event.source,
    })),
    vrHistory: vrRows.map((row) => ({
      seasonKey: row.seasonKey,
      highestBaseVr: row.highestBaseVr,
      updatedAt: row.updatedAt.toISOString(),
    })),
    eventScores: eventScoreRows.map((row) => {
      const parsed = parseEventMetadata(row.metadata);
      return {
        eventId: row.eventId,
        eventName: row.eventName,
        boardKey: null,
        score: parsed.score,
        rank: parsed.rank,
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
    commendations,
    violations,
    trainHighlights: trainRows.flatMap((row) => {
      const highlights: CommanderProfilePayload["trainHighlights"] = [];
      if (row.conductorMemberId === ashedMemberId) {
        highlights.push({
          date: row.date,
          role: "conductor",
          lockedAt: row.lockedAt?.toISOString() ?? null,
        });
      }
      if (row.vipMemberId === ashedMemberId) {
        highlights.push({
          date: row.date,
          role: "vip",
          lockedAt: row.lockedAt?.toISOString() ?? null,
        });
      }
      if (row.substituteForMemberId === ashedMemberId) {
        highlights.push({
          date: row.date,
          role: "substitute",
          lockedAt: row.lockedAt?.toISOString() ?? null,
        });
      }
      return highlights;
    }),
    operatingMode,
  };
}
