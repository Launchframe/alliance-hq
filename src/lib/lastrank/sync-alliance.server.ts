import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { fetchLastRankAlliancePage } from "@/lib/lastrank/fetch-alliance.server";
import {
  formatLastRankPowerLevel,
  matchLastRankMembersToHq,
  type LastRankHqRosterRow,
  type LastRankMatchResult,
} from "@/lib/lastrank/alliance-page.shared";
import { decideInboundStatApply } from "@/lib/hq-ashed-stat-sync/policy";
import {
  loadLatestNonDiscardedEventMeta,
  pendingUnsyncedFromMeta,
} from "@/lib/hq-ashed-stat-sync/inbound";
import { upsertCommanderThp } from "@/lib/thp/repository";
import { upsertCommanderLevel } from "@/lib/member-level/repository";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";

export type LastRankSyncApplyCounts = {
  thpApplied: number;
  thpSkipped: number;
  thpConflict: number;
  levelApplied: number;
  levelSkipped: number;
  levelConflict: number;
  powerUpdated: number;
};

export type LastRankAllianceSyncResult = {
  tag: string;
  lastrankAllianceId: string;
  hqAllianceId: string;
  lastRankCount: number;
  match: LastRankMatchResult;
  apply: LastRankSyncApplyCounts | null;
};

function namesForMember(row: {
  currentName: string;
  previousNamesJson: unknown;
  primaryName: string | null;
}): string[] {
  const previous = Array.isArray(row.previousNamesJson)
    ? row.previousNamesJson.filter((name): name is string => typeof name === "string")
    : [];
  const names = [row.currentName, ...previous];
  if (row.primaryName) names.push(row.primaryName);
  return names;
}

export async function loadHqRosterForLastRankMatch(
  allianceId: string,
): Promise<LastRankHqRosterRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      commanderId: schema.commanderAllianceMemberships.commanderId,
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
      status: schema.allianceMembers.status,
      primaryName: schema.commanders.primaryName,
      hqThp: schema.commanders.currentTotalHeroPower,
      hqLevel: schema.commanders.memberLevel,
      hqPowerLevel: schema.commanders.powerLevel,
    })
    .from(schema.allianceMembers)
    .innerJoin(
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
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    );

  return rows.map((row) => ({
    commanderId: row.commanderId,
    ashedMemberId: row.ashedMemberId,
    names: namesForMember(row),
    hqThp:
      row.hqThp != null && Number.isFinite(row.hqThp) ? Math.round(row.hqThp) : null,
    hqLevel: row.hqLevel,
    hqPowerLevel: row.hqPowerLevel,
  }));
}

async function resolveAllianceIdByTag(tag: string): Promise<string> {
  const db = getDb();
  const needle = tag.trim().toLowerCase();
  const rows = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(sql`lower(${schema.alliances.tag}) = ${needle}`)
    .limit(2);
  if (rows.length === 0) {
    throw new Error(`No HQ alliance with tag ${tag}`);
  }
  if (rows.length > 1) {
    throw new Error(`Multiple HQ alliances share tag ${tag}`);
  }
  return rows[0].id;
}

async function decideStat(
  table: "thp" | "level",
  commanderId: string,
  hqTotal: number | null,
  remoteTotal: number,
): Promise<"noop" | "apply" | "conflict"> {
  const meta = await loadLatestNonDiscardedEventMeta(table, commanderId);
  return decideInboundStatApply({
    hqTotal,
    hqLatestSource: meta.source,
    hqPendingUnsyncedSelfReport: pendingUnsyncedFromMeta(meta),
    hqUpdatedAt: meta.createdAt,
    ashedTotal: remoteTotal,
    ashedRecordedAt: new Date(),
  });
}

async function applyMatches(
  hqAllianceId: string,
  match: LastRankMatchResult,
): Promise<LastRankSyncApplyCounts> {
  const counts: LastRankSyncApplyCounts = {
    thpApplied: 0,
    thpSkipped: 0,
    thpConflict: 0,
    levelApplied: 0,
    levelSkipped: 0,
    levelConflict: 0,
    powerUpdated: 0,
  };
  const db = getDb();

  for (const row of match.matched) {
    const thp = row.lastRank.heroPower;
    if (thp != null && thp > 0) {
      const decision = await decideStat(
        "thp",
        row.hq.commanderId,
        row.hq.hqThp,
        Math.round(thp),
      );
      if (decision === "apply") {
        const changed = await upsertCommanderThp({
          commanderId: row.hq.commanderId,
          total: Math.round(thp),
          breakdown: null,
          allianceId: hqAllianceId,
          ashedMemberId: row.hq.ashedMemberId,
          memberName: row.lastRank.name,
          source: "lastrank_sync",
        });
        if (changed) counts.thpApplied += 1;
        else counts.thpSkipped += 1;
      } else if (decision === "conflict") {
        counts.thpConflict += 1;
      } else {
        counts.thpSkipped += 1;
      }
    } else {
      counts.thpSkipped += 1;
    }

    const level = normalizeMemberHqLevel(row.lastRank.baseLevel);
    if (level != null && level > 0) {
      const decision = await decideStat(
        "level",
        row.hq.commanderId,
        row.hq.hqLevel,
        level,
      );
      if (decision === "apply") {
        const changed = await upsertCommanderLevel({
          commanderId: row.hq.commanderId,
          total: level,
          allianceId: hqAllianceId,
          ashedMemberId: row.hq.ashedMemberId,
          memberName: row.lastRank.name,
          source: "lastrank_sync",
        });
        if (changed) counts.levelApplied += 1;
        else counts.levelSkipped += 1;
      } else if (decision === "conflict") {
        counts.levelConflict += 1;
      } else {
        counts.levelSkipped += 1;
      }
    } else {
      counts.levelSkipped += 1;
    }

    const powerLevel = formatLastRankPowerLevel(row.lastRank.power);
    if (powerLevel && powerLevel !== row.hq.hqPowerLevel) {
      await db
        .update(schema.commanders)
        .set({ powerLevel, updatedAt: new Date() })
        .where(eq(schema.commanders.id, row.hq.commanderId));
      counts.powerUpdated += 1;
    }
  }

  return counts;
}

export async function syncLastRankAlliance(input: {
  tag: string;
  lastrankAllianceId: string;
  apply: boolean;
}): Promise<LastRankAllianceSyncResult> {
  const hqAllianceId = await resolveAllianceIdByTag(input.tag);
  const page = await fetchLastRankAlliancePage(input.lastrankAllianceId);
  const hqRows = await loadHqRosterForLastRankMatch(hqAllianceId);
  const match = matchLastRankMembersToHq(page.members, hqRows);
  const apply = input.apply ? await applyMatches(hqAllianceId, match) : null;
  return {
    tag: input.tag,
    lastrankAllianceId: input.lastrankAllianceId,
    hqAllianceId,
    lastRankCount: page.members.length,
    match,
    apply,
  };
}
