import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  formatLastRankPowerLevel,
  lastRankPlayerProfileUrl,
  type LastRankAllianceMember,
  type LastRankHqRosterRow,
} from "@/lib/lastrank/alliance-page.shared";
import { syncCommanderFromAllianceMember } from "@/lib/members/commander-identity.server";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import {
  appendCommanderPowerLevelEventIfChanged,
  appendMemberGameLevelEventIfChanged,
} from "@/lib/members/member-stat-history.server";
import { nativeRosterAshedAllianceId } from "@/lib/native-alliance/provision";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { upsertCommanderThp } from "@/lib/thp/repository";
import { upsertCommanderLevel } from "@/lib/member-level/repository";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";

export type LastRankUpsertCounts = {
  membersCreated: number;
  membersRetired: number;
  profileUpdated: number;
};

export async function createAllianceMemberFromLastRank(input: {
  allianceId: string;
  gameServerNumber: number;
  lastRank: LastRankAllianceMember;
}): Promise<LastRankHqRosterRow> {
  const db = getDb();
  const now = new Date();
  const ashedMemberId = nanoid(16);
  const ashedAllianceId = nativeRosterAshedAllianceId(input.allianceId);
  const name = input.lastRank.name.trim();
  const rank = input.lastRank.allianceRank;
  const powerLevel = formatLastRankPowerLevel(input.lastRank.power);
  const level = normalizeMemberHqLevel(input.lastRank.baseLevel);
  const profileUrl = lastRankPlayerProfileUrl(input.lastRank.publicId);

  await db.insert(schema.allianceMembers).values({
    id: nanoid(),
    allianceId: input.allianceId,
    ashedMemberId,
    ashedAllianceId,
    currentName: name,
    previousNamesJson: [],
    status: "active",
    allianceRank:
      rank != null && rank >= 1 && rank <= 5 ? Math.round(rank) : null,
    allianceRankTitle: null,
    ashedRankRaw:
      rank != null && rank >= 1 && rank <= 5
        ? formatAshedMemberRankValue(Math.round(rank), null)
        : null,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (rank != null && rank >= 1 && rank <= 5) {
    await db.insert(schema.memberAllianceRankEvents).values({
      id: nanoid(),
      allianceId: input.allianceId,
      ashedMemberId,
      memberName: name,
      allianceRank: Math.round(rank),
      allianceRankTitle: null,
      effectiveDate: getServerCalendarDate(),
      source: "lastrank_sync",
      recordedByHqUserId: null,
    });
  }

  const syncResult = await syncCommanderFromAllianceMember({
    allianceId: input.allianceId,
    ashedMemberId,
    memberDisplayName: name,
    ashedStats: {
      memberLevel: level ?? undefined,
      powerLevel: powerLevel ?? undefined,
    },
    thpSource: "lastrank_sync",
  });

  const commanderId =
    syncResult.status === "synced" ? syncResult.commanderId : null;

  if (commanderId) {
    await db
      .update(schema.commanders)
      .set({
        gameServerNumber: input.gameServerNumber,
        lastrankPublicId: input.lastRank.publicId,
        lastrankCountry: input.lastRank.country,
        lastrankProfileUrl: profileUrl,
        canonicalName: name,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, commanderId));

    if (input.lastRank.heroPower != null && input.lastRank.heroPower > 0) {
      await upsertCommanderThp({
        commanderId,
        total: Math.round(input.lastRank.heroPower),
        breakdown: null,
        allianceId: input.allianceId,
        ashedMemberId,
        memberName: name,
        source: "lastrank_sync",
      });
    }
    if (level != null && level > 0) {
      await upsertCommanderLevel({
        commanderId,
        total: level,
        allianceId: input.allianceId,
        ashedMemberId,
        memberName: name,
        source: "lastrank_sync",
      });
    }
    if (powerLevel) {
      await appendCommanderPowerLevelEventIfChanged({
        commanderId,
        allianceId: input.allianceId,
        value: powerLevel,
        source: "lastrank_sync",
        recordedDate: getServerCalendarDate(),
      });
    }
    if (level != null) {
      await appendMemberGameLevelEventIfChanged({
        allianceId: input.allianceId,
        ashedMemberId,
        memberName: name,
        value: level,
        source: "lastrank_sync",
        recordedDate: getServerCalendarDate(),
      });
    }
  }

  return {
    commanderId: commanderId ?? ashedMemberId,
    ashedMemberId,
    gameUid: null,
    currentNames: [name],
    previousNames: [],
    hqThp:
      input.lastRank.heroPower != null
        ? Math.round(input.lastRank.heroPower)
        : null,
    hqLevel: level,
    hqPowerLevel: powerLevel,
    hqAllianceRank:
      rank != null && rank >= 1 && rank <= 5 ? Math.round(rank) : null,
    existingCanonicalName: name,
    lastrankPublicId: input.lastRank.publicId,
    lastrankCountry: input.lastRank.country,
    lastrankProfileImageUrl: null,
    lastrankProfileUrl: profileUrl,
  };
}

export async function updateLastRankProfileFields(
  commanderId: string,
  lastRank: LastRankAllianceMember,
): Promise<boolean> {
  const db = getDb();
  const profileUrl = lastRankPlayerProfileUrl(lastRank.publicId);
  const [existing] = await db
    .select({
      lastrankPublicId: schema.commanders.lastrankPublicId,
      lastrankCountry: schema.commanders.lastrankCountry,
      lastrankProfileUrl: schema.commanders.lastrankProfileUrl,
      lastrankProfileImageUrl: schema.commanders.lastrankProfileImageUrl,
    })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, commanderId))
    .limit(1);
  if (!existing) return false;

  const next = {
    lastrankPublicId: lastRank.publicId,
    lastrankCountry: lastRank.country,
    lastrankProfileUrl: profileUrl,
    lastrankProfileImageUrl: existing.lastrankProfileImageUrl,
  };
  if (
    existing.lastrankPublicId === next.lastrankPublicId &&
    existing.lastrankCountry === next.lastrankCountry &&
    existing.lastrankProfileUrl === next.lastrankProfileUrl
  ) {
    return false;
  }

  await db
    .update(schema.commanders)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(schema.commanders.id, commanderId));
  return true;
}

export async function retireAllianceMembers(input: {
  allianceId: string;
  ashedMemberIds: string[];
}): Promise<number> {
  if (input.ashedMemberIds.length === 0) return 0;
  const db = getDb();
  const now = new Date();

  await db
    .update(schema.allianceMembers)
    .set({ status: "former", updatedAt: now })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        inArray(schema.allianceMembers.ashedMemberId, input.ashedMemberIds),
      ),
    );

  for (const ashedMemberId of input.ashedMemberIds) {
    await syncCommanderFromAllianceMember({
      allianceId: input.allianceId,
      ashedMemberId,
      leftAt: now,
    });
  }

  const { pruneFormerMembersFromOpenPools } = await import("@/lib/trains/pool");
  await pruneFormerMembersFromOpenPools(input.allianceId);
  return input.ashedMemberIds.length;
}

export async function listActiveMemberIdsNotInSet(
  allianceId: string,
  keepAshedMemberIds: Set<string>,
): Promise<Array<{ ashedMemberId: string; currentName: string }>> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    );
  return rows.filter((row) => !keepAshedMemberIds.has(row.ashedMemberId));
}
