import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { fetchLastRankAlliancePage } from "@/lib/lastrank/fetch-alliance.server";
import {
  applyInteractiveMatches,
  formatLastRankPowerLevel,
  matchLastRankMembersToHq,
  resolveHqNameToRosterRow,
  type LastRankHqRosterRow,
  type LastRankMatchResult,
  type LastRankUnmatchedRow,
} from "@/lib/lastrank/alliance-page.shared";
import { decideInboundStatApply } from "@/lib/hq-ashed-stat-sync/policy";
import {
  loadLatestNonDiscardedEventMeta,
  pendingUnsyncedFromMeta,
} from "@/lib/hq-ashed-stat-sync/inbound";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { upsertCommanderThp } from "@/lib/thp/repository";
import { upsertCommanderLevel } from "@/lib/member-level/repository";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";
import { namesMatch } from "@/lib/vr/link-helpers";

export type LastRankSyncApplyCounts = {
  thpApplied: number;
  thpSkipped: number;
  thpConflict: number;
  levelApplied: number;
  levelSkipped: number;
  levelConflict: number;
  powerUpdated: number;
  canonicalWritten: number;
  canonicalSkippedNoUid: number;
  canonicalSkippedMismatch: number;
  canonicalSkippedLookupFailed: number;
  canonicalUnchanged: number;
};

export type LastRankInteractivePrompt = (ctx: {
  lastRankName: string;
  publicId: number;
  suggestions: LastRankUnmatchedRow["suggestions"];
  remainingHqNames: string[];
}) => Promise<string | null>;

export type LastRankAllianceSyncResult = {
  tag: string;
  lastrankAllianceId: string;
  hqAllianceId: string;
  lastRankCount: number;
  match: LastRankMatchResult;
  apply: LastRankSyncApplyCounts | null;
};

function previousNamesFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((name): name is string => typeof name === "string");
}

function buildCurrentNames(row: {
  currentName: string;
  primaryName: string | null;
  canonicalName: string | null;
}): string[] {
  const names: string[] = [row.currentName];
  if (row.primaryName) names.push(row.primaryName);
  if (row.canonicalName) names.push(row.canonicalName);
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
      gameUid: schema.commanders.gameUid,
      canonicalName: schema.commanders.canonicalName,
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
    gameUid: row.gameUid,
    currentNames: buildCurrentNames(row),
    previousNames: previousNamesFromJson(row.previousNamesJson),
    hqThp:
      row.hqThp != null && Number.isFinite(row.hqThp) ? Math.round(row.hqThp) : null,
    hqLevel: row.hqLevel,
    hqPowerLevel: row.hqPowerLevel,
    existingCanonicalName: row.canonicalName,
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

async function writeCanonicalIfLastWarConfirms(
  counts: LastRankSyncApplyCounts,
  commanderId: string,
  gameUid: string | null,
  existingCanonicalName: string | null,
  lastRankCanon: string,
): Promise<void> {
  if (!gameUid?.trim()) {
    counts.canonicalSkippedNoUid += 1;
    return;
  }
  const lookup = await lookupPlayerByUid(gameUid);
  if (!lookup.ok) {
    counts.canonicalSkippedLookupFailed += 1;
    return;
  }
  if (!namesMatch(lastRankCanon, lookup.gameUserName)) {
    counts.canonicalSkippedMismatch += 1;
    return;
  }
  if (existingCanonicalName === lastRankCanon) {
    counts.canonicalUnchanged += 1;
    return;
  }
  const db = getDb();
  await db
    .update(schema.commanders)
    .set({ canonicalName: lastRankCanon, updatedAt: new Date() })
    .where(eq(schema.commanders.id, commanderId));
  counts.canonicalWritten += 1;
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
    canonicalWritten: 0,
    canonicalSkippedNoUid: 0,
    canonicalSkippedMismatch: 0,
    canonicalSkippedLookupFailed: 0,
    canonicalUnchanged: 0,
  };
  const db = getDb();

  for (const row of match.matched) {
    await writeCanonicalIfLastWarConfirms(
      counts,
      row.hq.commanderId,
      row.hq.gameUid,
      row.hq.existingCanonicalName,
      row.lastRank.name,
    );

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

async function runInteractiveResolutions(
  match: LastRankMatchResult,
  prompt: LastRankInteractivePrompt,
): Promise<LastRankMatchResult> {
  const claimed = new Set(match.matched.map((row) => row.hq.commanderId));
  const allHq = [
    ...match.matched.map((row) => row.hq),
    ...match.unmatchedHq,
  ];
  const resolutions: Array<{
    lastRankPublicId: number;
    hq: LastRankHqRosterRow;
  }> = [];

  for (const row of match.unmatched) {
    if (row.status !== "unmatched" && row.status !== "ambiguous") continue;

    const remainingHqNames = allHq
      .filter((hq) => !claimed.has(hq.commanderId))
      .map((hq) => hq.currentNames[0] ?? hq.previousNames[0] ?? hq.commanderId);

    const answer = await prompt({
      lastRankName: row.lastRank.name,
      publicId: row.lastRank.publicId,
      suggestions: row.suggestions,
      remainingHqNames,
    });
    if (answer == null || !answer.trim()) continue;

    const resolved = resolveHqNameToRosterRow(answer, allHq, claimed);
    if (!resolved.ok) {
      console.error(
        `Could not map "${row.lastRank.name}" → "${answer}" (${resolved.reason})`,
      );
      continue;
    }
    claimed.add(resolved.hq.commanderId);
    resolutions.push({
      lastRankPublicId: row.lastRank.publicId,
      hq: resolved.hq,
    });
  }

  if (resolutions.length === 0) return match;
  return applyInteractiveMatches(match, resolutions);
}

export async function syncLastRankAlliance(input: {
  tag: string;
  lastrankAllianceId: string;
  apply: boolean;
  interactivePrompt?: LastRankInteractivePrompt;
}): Promise<LastRankAllianceSyncResult> {
  const hqAllianceId = await resolveAllianceIdByTag(input.tag);
  const page = await fetchLastRankAlliancePage(input.lastrankAllianceId);
  const hqRows = await loadHqRosterForLastRankMatch(hqAllianceId);
  let match = matchLastRankMembersToHq(page.members, hqRows);
  if (input.interactivePrompt && match.unmatched.length > 0) {
    match = await runInteractiveResolutions(match, input.interactivePrompt);
  }
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
