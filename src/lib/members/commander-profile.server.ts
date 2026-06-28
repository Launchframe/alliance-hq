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
  listCommanderTenureHistoryByGameUid,
} from "@/lib/members/commander-identity.server";
import {
  formatMemberRankDisplay,
  parseAshedMemberAllianceRank,
} from "@/lib/members/alliance-rank";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import { sessionHasPermission } from "@/lib/rbac/context";
import type { CommanderProfilePayload } from "@/lib/members/commander-profile.shared";
import { getAshedConnection } from "@/lib/session";
import { viewerCanEditMainSquad } from "@/lib/commanders/main-squad.server";

export type { CommanderProfilePayload } from "@/lib/members/commander-profile.shared";

type AshedRecord = Record<string, unknown>;

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

/** HQ user who linked this commander via name+UID — not alliance R5/officer RBAC. */
async function viewerOwnsCommander(input: {
  commanderId: string | null | undefined;
  hqUserId: string | null;
  allianceId: string;
  ashedMemberId: string;
}): Promise<boolean> {
  if (!input.hqUserId) return false;

  const db = getDb();
  if (input.commanderId) {
    const [owned] = await db
      .select({ id: schema.hqUserCommanders.id })
      .from(schema.hqUserCommanders)
      .where(
        and(
          eq(schema.hqUserCommanders.commanderId, input.commanderId),
          eq(schema.hqUserCommanders.hqUserId, input.hqUserId),
        ),
      )
      .limit(1);
    if (owned) return true;
  }

  const [linkedMember] = await db
    .select({ id: schema.hqMemberLinks.id })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, input.ashedMemberId),
        eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
      ),
    )
    .limit(1);
  return linkedMember != null;
}

export async function loadCommanderProfile(
  sessionId: string,
  ashedMemberId: string,
): Promise<CommanderProfilePayload | null> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(sessionId);
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

  const [commanderIdentity] = await db
    .select({
      commanderId: schema.commanders.id,
      gameUid: schema.commanders.gameUid,
      primaryName: schema.commanders.primaryName,
      heroPowerM: schema.commanders.heroPowerM,
      memberLevel: schema.commanders.memberLevel,
      mainSquad: schema.commanders.mainSquad,
      mainSquadSource: schema.commanders.mainSquadSource,
      membershipStatus: schema.commanderAllianceMemberships.status,
      allianceRank: schema.commanderAllianceMemberships.allianceRank,
      allianceRankTitle: schema.commanderAllianceMemberships.allianceRankTitle,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanderAllianceMemberships.commanderId, schema.commanders.id),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  let hqUser: CommanderProfilePayload["hqUser"] = null;
  if (commanderIdentity) {
    const [user] = await db
      .select({
        id: schema.hqUsers.id,
        displayName: schema.hqUsers.displayName,
        email: schema.hqUsers.email,
      })
      .from(schema.hqUserCommanders)
      .innerJoin(
        schema.hqUsers,
        eq(schema.hqUserCommanders.hqUserId, schema.hqUsers.id),
      )
      .where(eq(schema.hqUserCommanders.commanderId, commanderIdentity.commanderId))
      .orderBy(
        desc(schema.hqUserCommanders.isPrimary),
        desc(schema.hqUserCommanders.linkedAt),
      )
      .limit(1);
    if (user) {
      hqUser = {
        id: user.id,
        displayName: user.displayName,
        email: canSeeEmail ? user.email : null,
      };
    }
  }
  if (!hqUser && hqLink) {
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
    commanderIdentity?.gameUid?.trim() ??
    hqLink?.gameUid?.trim() ??
    discordLinks[0]?.gameUid?.trim() ??
    null;

  let tenureRows: Awaited<ReturnType<typeof listTenureHistoryByGameUid>> = [];
  if (gameUid) {
    const commanderTenure = await listCommanderTenureHistoryByGameUid(gameUid);
    tenureRows =
      commanderTenure.length > 0
        ? commanderTenure
        : await listTenureHistoryByGameUid(gameUid);
  }

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
  const rankForDisplay =
    commanderIdentity?.allianceRank != null
      ? {
          rank: commanderIdentity.allianceRank,
          title: commanderIdentity.allianceRankTitle,
        }
      : parseAshedMemberAllianceRank(ashedMember);
  const { rankLabel, titleLabel } = formatMemberRankDisplay(
    rankForDisplay,
    "—",
  );
  const viewerIsOwner = await viewerOwnsCommander({
    commanderId: commanderIdentity?.commanderId,
    hqUserId,
    allianceId,
    ashedMemberId,
  });
  const canOfficerOverrideMainSquad = await sessionHasPermission(
    sessionId,
    "members:write",
  );
  const canEditMainSquad = await viewerCanEditMainSquad({
    sessionId,
    allianceId,
    ashedMemberId,
  });

  return {
    member: {
      ashedMemberId,
      currentName: commanderIdentity?.primaryName ?? memberRow.currentName,
      previousNames: memberRow.previousNamesJson ?? [],
      status: commanderIdentity?.membershipStatus ?? memberRow.status,
      rankLabel,
      titleLabel,
      heroPowerM: commanderIdentity?.heroPowerM ?? memberRow.heroPowerM,
      memberLevel: commanderIdentity?.memberLevel ?? memberRow.memberLevel,
      mainSquad: memberRow.mainSquad ?? commanderIdentity?.mainSquad ?? null,
      mainSquadSource: commanderIdentity?.mainSquadSource ?? null,
      canEditMainSquad,
      viewerIsOwner,
      canOfficerOverrideMainSquad,
      viewerCanIssueClaimInvite: canOfficerOverrideMainSquad,
      gameUid: viewerIsOwner ? gameUid : null,
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
