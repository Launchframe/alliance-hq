import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  formatLastRankPowerLevel,
  lastRankPlayerProfileUrl,
  type LastRankAllianceMember,
  type LastRankHqRosterRow,
} from "@/lib/lastrank/alliance-page.shared";
import {
  isSyntheticNativeAshedAllianceId,
  type LastRankAshedWriteContext,
} from "@/lib/lastrank/ashed-credential.server";
import {
  createAshedMember,
  markAshedMemberFormer,
} from "@/lib/members/ashed-member-write.server";
import { syncCommanderFromAllianceMember } from "@/lib/members/commander-identity.server";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import { syncMemberNameToAshed } from "@/lib/members/member-name-sync.server";
import {
  appendCommanderPowerLevelEventIfChanged,
  appendMemberGameLevelEventIfChanged,
} from "@/lib/members/member-stat-history.server";
import { nativeRosterAshedAllianceId } from "@/lib/native-alliance/provision";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { upsertCommanderThp } from "@/lib/thp/repository";
import { upsertCommanderLevel } from "@/lib/member-level/repository";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";
import { syncMemberRankToAshed } from "@/lib/trains/rank-sync";
import { nextPreviousNames } from "@/lib/video/scoreboard-member-actions.shared";

export type LastRankUpsertCounts = {
  membersCreated: number;
  membersRetired: number;
  profileUpdated: number;
  ashedMembersCreated: number;
  ashedMembersRetired: number;
  ashedSkipped: number;
};

export async function createAllianceMemberFromLastRank(input: {
  allianceId: string;
  gameServerNumber: number;
  lastRank: LastRankAllianceMember;
  ashed?: LastRankAshedWriteContext | null;
}): Promise<{
  hq: LastRankHqRosterRow;
  ashedCreated: boolean;
}> {
  const db = getDb();
  const now = new Date();
  const name = input.lastRank.name.trim();
  const rank = input.lastRank.allianceRank;
  const powerLevel = formatLastRankPowerLevel(input.lastRank.power);
  const level = normalizeMemberHqLevel(input.lastRank.baseLevel);
  const profileUrl = lastRankPlayerProfileUrl(input.lastRank.publicId);

  let ashedMemberId = nanoid(16);
  let ashedAllianceId = nativeRosterAshedAllianceId(input.allianceId);
  let ashedCreated = false;

  if (input.ashed) {
    ashedMemberId = await createAshedMember({
      connection: input.ashed.connection,
      ashedAllianceId: input.ashed.ashedAllianceId,
      currentName: name,
    });
    ashedAllianceId = input.ashed.ashedAllianceId;
    ashedCreated = true;
    if (rank != null && rank >= 1 && rank <= 5) {
      try {
        await syncMemberRankToAshed(
          input.ashed.connection,
          ashedMemberId,
          Math.round(rank),
          null,
        );
      } catch (error) {
        console.error(
          `[lastrank] Ashed rank PUT failed for ${name}: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
      }
    }
  }

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
    ashedCreated,
    hq: {
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
    },
  };
}

/**
 * Interactive map + `--apply`: adopt LastRank name as HQ current/canonical,
 * push the prior HQ name into `previous_names`, and dual-write Ashed when linked.
 */
export async function applyInteractiveNameMapping(input: {
  allianceId: string;
  ashedMemberId: string;
  commanderId: string;
  lastRankName: string;
  ashed?: LastRankAshedWriteContext | null;
}): Promise<{
  renamed: boolean;
  ashedSynced: boolean;
  canonicalWritten: boolean;
}> {
  const nextName = input.lastRankName.trim();
  if (!nextName) {
    return { renamed: false, ashedSynced: false, canonicalWritten: false };
  }

  const db = getDb();
  const [member] = await db
    .select({
      id: schema.allianceMembers.id,
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
      ashedAllianceId: schema.allianceMembers.ashedAllianceId,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);
  if (!member) {
    return { renamed: false, ashedSynced: false, canonicalWritten: false };
  }

  const previousNames = member.previousNamesJson ?? [];
  const nextPrevious = nextPreviousNames(
    member.currentName,
    previousNames,
    nextName,
  );
  const renamed =
    member.currentName !== nextName || nextPrevious !== previousNames;

  let ashedSynced = false;
  if (
    input.ashed &&
    !isSyntheticNativeAshedAllianceId(member.ashedAllianceId) &&
    member.ashedAllianceId === input.ashed.ashedAllianceId
  ) {
    try {
      await syncMemberNameToAshed(
        input.ashed.connection,
        input.ashedMemberId,
        nextName,
        nextPrevious,
      );
      ashedSynced = true;
    } catch (error) {
      console.error(
        `[lastrank] Ashed name PUT failed for ${member.currentName} → ${nextName}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  if (renamed) {
    await db
      .update(schema.allianceMembers)
      .set({
        currentName: nextName,
        previousNamesJson: nextPrevious,
        updatedAt: new Date(),
      })
      .where(eq(schema.allianceMembers.id, member.id));
    await syncCommanderFromAllianceMember({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: nextName,
    });
  }

  const [commander] = await db
    .select({ canonicalName: schema.commanders.canonicalName })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, input.commanderId))
    .limit(1);
  let canonicalWritten = false;
  if (commander && commander.canonicalName !== nextName) {
    await db
      .update(schema.commanders)
      .set({ canonicalName: nextName, updatedAt: new Date() })
      .where(eq(schema.commanders.id, input.commanderId));
    canonicalWritten = true;
  }

  return { renamed, ashedSynced, canonicalWritten };
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
  ashed?: {
    connection: ParsedConnection;
    /** Only PUT members whose ashedAllianceId matches this linked id. */
    ashedAllianceId: string;
  } | null;
}): Promise<{ retired: number; ashedRetired: number; ashedSkipped: number }> {
  if (input.ashedMemberIds.length === 0) {
    return { retired: 0, ashedRetired: 0, ashedSkipped: 0 };
  }
  const db = getDb();
  const now = new Date();

  let ashedRetired = 0;
  let ashedSkipped = 0;
  if (input.ashed) {
    const rows = await db
      .select({
        ashedMemberId: schema.allianceMembers.ashedMemberId,
        ashedAllianceId: schema.allianceMembers.ashedAllianceId,
        currentName: schema.allianceMembers.currentName,
      })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          inArray(
            schema.allianceMembers.ashedMemberId,
            input.ashedMemberIds,
          ),
        ),
      );
    for (const row of rows) {
      if (
        isSyntheticNativeAshedAllianceId(row.ashedAllianceId) ||
        row.ashedAllianceId !== input.ashed.ashedAllianceId
      ) {
        ashedSkipped += 1;
        continue;
      }
      try {
        await markAshedMemberFormer({
          connection: input.ashed.connection,
          ashedMemberId: row.ashedMemberId,
        });
        ashedRetired += 1;
      } catch (error) {
        console.error(
          `[lastrank] Ashed former PUT failed for ${row.currentName}: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        ashedSkipped += 1;
      }
    }
  }

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
  return {
    retired: input.ashedMemberIds.length,
    ashedRetired,
    ashedSkipped,
  };
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
