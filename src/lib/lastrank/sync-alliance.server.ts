import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { fetchLastRankAlliancePage } from "@/lib/lastrank/fetch-alliance.server";
import {
  resolveHqAllianceForLastRankSync,
  type LastRankAllianceResolvePrompt,
} from "@/lib/lastrank/alliance-resolve.server";
import {
  applyInteractiveMatches,
  formatLastRankPowerLevel,
  matchLastRankMembersToHq,
  resolveHqNameToRosterRow,
  type LastRankHqRosterRow,
  type LastRankInteractiveAnswer,
  type LastRankMatchedRow,
  type LastRankMatchResult,
  type LastRankUnmatchedRow,
} from "@/lib/lastrank/alliance-page.shared";
import type { LastRankSyncTarget } from "@/lib/lastrank/sync-registry.shared";
import {
  createAllianceMemberFromLastRank,
  listActiveMemberIdsNotInSet,
  retireAllianceMembers,
  updateLastRankProfileFields,
  type LastRankUpsertCounts,
} from "@/lib/lastrank/sync-upsert.server";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import { appendCommanderPowerLevelEventIfChanged } from "@/lib/members/member-stat-history.server";
import { upsertCommanderThp } from "@/lib/thp/repository";
import { upsertCommanderLevel } from "@/lib/member-level/repository";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { namesMatch } from "@/lib/vr/link-helpers";

export type LastRankSyncApplyCounts = LastRankUpsertCounts & {
  thpApplied: number;
  thpSkipped: number;
  thpConflict: number;
  levelApplied: number;
  levelSkipped: number;
  levelConflict: number;
  powerUpdated: number;
  rankApplied: number;
  rankUnchanged: number;
  rankSkippedMissing: number;
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
}) => Promise<LastRankInteractiveAnswer>;

export type LastRankRetirePrompt = (ctx: {
  memberName: string;
  ashedMemberId: string;
}) => Promise<boolean>;

export type LastRankAllianceSyncResult = {
  tag: string;
  gameServerNumber: number;
  lastrankAllianceId: string;
  hqAllianceId: string;
  allianceCreated: boolean;
  lastRankCount: number;
  match: LastRankMatchResult;
  apply: LastRankSyncApplyCounts | null;
};

export type LastRankInteractiveMatchResolved = (row: LastRankMatchedRow) => Promise<void>;

function emptyApplyCounts(): LastRankSyncApplyCounts {
  return {
    membersCreated: 0,
    membersRetired: 0,
    profileUpdated: 0,
    thpApplied: 0,
    thpSkipped: 0,
    thpConflict: 0,
    levelApplied: 0,
    levelSkipped: 0,
    levelConflict: 0,
    powerUpdated: 0,
    rankApplied: 0,
    rankUnchanged: 0,
    rankSkippedMissing: 0,
    canonicalWritten: 0,
    canonicalSkippedNoUid: 0,
    canonicalSkippedMismatch: 0,
    canonicalSkippedLookupFailed: 0,
    canonicalUnchanged: 0,
  };
}

function mergeApplyCounts(
  target: LastRankSyncApplyCounts,
  source: LastRankSyncApplyCounts,
): void {
  for (const key of Object.keys(source) as Array<keyof LastRankSyncApplyCounts>) {
    target[key] += source[key];
  }
}

async function syncRankPoolIfNeeded(
  hqAllianceId: string,
  ranksChanged: boolean,
): Promise<void> {
  if (!ranksChanged) return;
  try {
    const { syncRankEligibilityForCurrentGenerations } = await import(
      "@/lib/trains/pool-rank-eligibility.server"
    );
    await syncRankEligibilityForCurrentGenerations(hqAllianceId);
  } catch (error) {
    console.error(
      "LastRank rank apply: pool eligibility sync skipped:",
      error instanceof Error ? error.message : error,
    );
  }
}

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
      lastrankPublicId: schema.commanders.lastrankPublicId,
      lastrankCountry: schema.commanders.lastrankCountry,
      lastrankProfileImageUrl: schema.commanders.lastrankProfileImageUrl,
      lastrankProfileUrl: schema.commanders.lastrankProfileUrl,
      hqThp: schema.commanders.currentTotalHeroPower,
      hqLevel: schema.commanders.memberLevel,
      hqPowerLevel: schema.commanders.powerLevel,
      hqAllianceRank: schema.allianceMembers.allianceRank,
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
    hqAllianceRank:
      row.hqAllianceRank != null &&
      Number.isFinite(row.hqAllianceRank) &&
      row.hqAllianceRank >= 1 &&
      row.hqAllianceRank <= 5
        ? Math.round(row.hqAllianceRank)
        : null,
    existingCanonicalName: row.canonicalName,
    lastrankPublicId: row.lastrankPublicId,
    lastrankCountry: row.lastrankCountry,
    lastrankProfileImageUrl: row.lastrankProfileImageUrl,
    lastrankProfileUrl: row.lastrankProfileUrl,
  }));
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

async function writeLastRankAllianceRank(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  allianceRank: number;
  effectiveDate: string;
}): Promise<void> {
  const db = getDb();
  const eventId = nanoid();
  const now = new Date();
  const ashedRankRaw = formatAshedMemberRankValue(input.allianceRank, null);

  await db.insert(schema.memberAllianceRankEvents).values({
    id: eventId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    allianceRank: input.allianceRank,
    allianceRankTitle: null,
    effectiveDate: input.effectiveDate,
    source: "lastrank_sync",
    recordedByHqUserId: null,
  });

  await db
    .update(schema.allianceMembers)
    .set({
      allianceRank: input.allianceRank,
      allianceRankTitle: null,
      ashedRankRaw,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    );
}

async function applyMatchedRows(
  hqAllianceId: string,
  rows: LastRankMatchedRow[],
  counts: LastRankSyncApplyCounts,
): Promise<boolean> {
  const db = getDb();
  const effectiveDate = getServerCalendarDate();
  let ranksChanged = false;

  for (const row of rows) {
    if (
      await updateLastRankProfileFields(row.hq.commanderId, row.lastRank)
    ) {
      counts.profileUpdated += 1;
    }

    await writeCanonicalIfLastWarConfirms(
      counts,
      row.hq.commanderId,
      row.hq.gameUid,
      row.hq.existingCanonicalName,
      row.lastRank.name,
    );

    const lastRankAllianceRank = row.lastRank.allianceRank;
    if (
      lastRankAllianceRank != null &&
      Number.isInteger(lastRankAllianceRank) &&
      lastRankAllianceRank >= 1 &&
      lastRankAllianceRank <= 5
    ) {
      if (row.hq.hqAllianceRank === lastRankAllianceRank) {
        counts.rankUnchanged += 1;
      } else {
        await writeLastRankAllianceRank({
          allianceId: hqAllianceId,
          ashedMemberId: row.hq.ashedMemberId,
          memberName: row.lastRank.name,
          allianceRank: lastRankAllianceRank,
          effectiveDate,
        });
        counts.rankApplied += 1;
        ranksChanged = true;
      }
    } else {
      counts.rankSkippedMissing += 1;
    }

    const thp = row.lastRank.heroPower;
    if (thp != null && thp > 0) {
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
    } else {
      counts.thpSkipped += 1;
    }

    const level = normalizeMemberHqLevel(row.lastRank.baseLevel);
    if (level != null && level > 0) {
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
    } else {
      counts.levelSkipped += 1;
    }

    const powerLevel = formatLastRankPowerLevel(row.lastRank.power);
    if (powerLevel) {
      if (powerLevel !== row.hq.hqPowerLevel) {
        await db
          .update(schema.commanders)
          .set({ powerLevel, updatedAt: new Date() })
          .where(eq(schema.commanders.id, row.hq.commanderId));
        counts.powerUpdated += 1;
      }
      await appendCommanderPowerLevelEventIfChanged({
        commanderId: row.hq.commanderId,
        allianceId: hqAllianceId,
        value: powerLevel,
        source: "lastrank_sync",
        recordedDate: effectiveDate,
      });
    }
  }

  return ranksChanged;
}

async function persistInteractiveMatchMapping(
  row: LastRankMatchedRow,
  counts: LastRankSyncApplyCounts,
): Promise<void> {
  if (await updateLastRankProfileFields(row.hq.commanderId, row.lastRank)) {
    counts.profileUpdated += 1;
  }
}

async function runInteractiveResolutions(
  match: LastRankMatchResult,
  prompt: LastRankInteractivePrompt,
  options: {
    onResolved?: LastRankInteractiveMatchResolved;
    allianceId: string;
    gameServerNumber: number;
    onMemberCreated?: () => void;
  },
): Promise<LastRankMatchResult> {
  let current = match;
  const claimed = new Set(match.matched.map((row) => row.hq.commanderId));
  const allHq = [
    ...match.matched.map((row) => row.hq),
    ...match.unmatchedHq,
  ];

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
    if (answer.kind === "skip") continue;

    if (answer.kind === "create") {
      const hq = await createAllianceMemberFromLastRank({
        allianceId: options.allianceId,
        gameServerNumber: options.gameServerNumber,
        lastRank: row.lastRank,
      });
      claimed.add(hq.commanderId);
      allHq.push(hq);
      options.onMemberCreated?.();

      current = applyInteractiveMatches(current, [
        { lastRankPublicId: row.lastRank.publicId, hq },
      ]);
      const matchedRow = current.matched.find(
        (matched) =>
          matched.matchMethod === "interactive" &&
          matched.lastRank.publicId === row.lastRank.publicId,
      );
      if (matchedRow) {
        await options.onResolved?.(matchedRow);
      }
      console.error(`Created: ${row.lastRank.name}`);
      continue;
    }

    const resolved = resolveHqNameToRosterRow(answer.hqName, allHq, claimed);
    if (!resolved.ok) {
      console.error(
        `Could not map "${row.lastRank.name}" → "${answer.hqName}" (${resolved.reason})`,
      );
      continue;
    }
    claimed.add(resolved.hq.commanderId);

    const resolution = {
      lastRankPublicId: row.lastRank.publicId,
      hq: resolved.hq,
    };
    current = applyInteractiveMatches(current, [resolution]);

    const matchedRow = current.matched.find(
      (matched) =>
        matched.matchMethod === "interactive" &&
        matched.lastRank.publicId === row.lastRank.publicId,
    );
    if (matchedRow) {
      await options.onResolved?.(matchedRow);
    }
  }

  return current;
}

async function createUnmatchedLastRankMembers(
  hqAllianceId: string,
  gameServerNumber: number,
  match: LastRankMatchResult,
): Promise<{ match: LastRankMatchResult; created: number }> {
  let created = 0;
  const matched = [...match.matched];
  const stillUnmatched: LastRankMatchResult["unmatched"] = [];

  for (const row of match.unmatched) {
    if (row.status !== "unmatched") {
      stillUnmatched.push(row);
      continue;
    }
    const hq = await createAllianceMemberFromLastRank({
      allianceId: hqAllianceId,
      gameServerNumber,
      lastRank: row.lastRank,
    });
    created += 1;
    matched.push({
      status: "matched",
      lastRank: row.lastRank,
      hq,
      matchMethod: "interactive",
      fuzzyScore: null,
    });
    console.error(`Created: ${row.lastRank.name}`);
  }

  const matchedIds = new Set(matched.map((row) => row.hq.commanderId));
  return {
    created,
    match: {
      matched,
      unmatched: stillUnmatched,
      unmatchedHq: match.unmatchedHq.filter(
        (row) => !matchedIds.has(row.commanderId),
      ),
    },
  };
}

async function runInteractiveRetires(
  hqAllianceId: string,
  match: LastRankMatchResult,
  prompt: LastRankRetirePrompt,
): Promise<{ match: LastRankMatchResult; retired: number }> {
  const keepIds = new Set(match.matched.map((row) => row.hq.ashedMemberId));
  const candidates = await listActiveMemberIdsNotInSet(hqAllianceId, keepIds);
  const toRetire: string[] = [];
  let retired = 0;

  for (const member of candidates) {
    const shouldRetire = await prompt({
      memberName: member.currentName,
      ashedMemberId: member.ashedMemberId,
    });
    if (!shouldRetire) continue;

    retired += await retireAllianceMembers({
      allianceId: hqAllianceId,
      ashedMemberIds: [member.ashedMemberId],
    });
    toRetire.push(member.ashedMemberId);
    console.error(`Retired: ${member.currentName}`);
  }

  return {
    retired,
    match: {
      ...match,
      unmatchedHq: match.unmatchedHq.filter(
        (row) => !toRetire.includes(row.ashedMemberId),
      ),
    },
  };
}

export async function syncLastRankAlliance(input: {
  target: LastRankSyncTarget;
  apply: boolean;
  /** After matching (and optional interactive), create HQ members for remaining unmatched LastRank rows. */
  createAllUnmatched?: boolean;
  interactivePrompt?: LastRankInteractivePrompt;
  alliancePrompt?: LastRankAllianceResolvePrompt;
  retirePrompt?: LastRankRetirePrompt;
}): Promise<LastRankAllianceSyncResult> {
  const { allianceId: hqAllianceId, created: allianceCreated } =
    await resolveHqAllianceForLastRankSync({
      target: input.target,
      allowCreate: input.apply,
      alliancePrompt: input.alliancePrompt,
    });

  const page = await fetchLastRankAlliancePage(input.target.lastrankAllianceId);
  const hqRows = await loadHqRosterForLastRankMatch(hqAllianceId);
  let match = matchLastRankMembersToHq(page.members, hqRows);

  const appliedDuringInteractive = new Set<string>();
  const trackApply =
    input.apply || Boolean(input.interactivePrompt);
  const applyCounts: LastRankSyncApplyCounts | null = trackApply
    ? emptyApplyCounts()
    : null;

  const onInteractiveResolved: LastRankInteractiveMatchResolved = async (row) => {
    const hqName =
      row.hq.currentNames[0] ??
      row.hq.previousNames[0] ??
      row.hq.commanderId;
    if (input.apply && applyCounts) {
      const partial = emptyApplyCounts();
      const ranksChanged = await applyMatchedRows(hqAllianceId, [row], partial);
      mergeApplyCounts(applyCounts, partial);
      appliedDuringInteractive.add(row.hq.commanderId);
      await syncRankPoolIfNeeded(hqAllianceId, ranksChanged);
      console.error(`Saved: ${row.lastRank.name} → ${hqName}`);
      return;
    }
    if (applyCounts) {
      await persistInteractiveMatchMapping(row, applyCounts);
      console.error(`Saved mapping: ${row.lastRank.name} → ${hqName}`);
    }
  };

  if (input.interactivePrompt && match.unmatched.length > 0) {
    match = await runInteractiveResolutions(match, input.interactivePrompt, {
      onResolved: onInteractiveResolved,
      allianceId: hqAllianceId,
      gameServerNumber: input.target.gameServerNumber,
      onMemberCreated: () => {
        if (applyCounts) applyCounts.membersCreated += 1;
      },
    });
  }

  if (input.apply && applyCounts) {
    if (input.createAllUnmatched) {
      const created = await createUnmatchedLastRankMembers(
        hqAllianceId,
        input.target.gameServerNumber,
        match,
      );
      match = created.match;
      applyCounts.membersCreated += created.created;
    }

    const remaining = match.matched.filter(
      (row) => !appliedDuringInteractive.has(row.hq.commanderId),
    );
    const partial = emptyApplyCounts();
    const ranksChanged = await applyMatchedRows(
      hqAllianceId,
      remaining,
      partial,
    );
    mergeApplyCounts(applyCounts, partial);
    await syncRankPoolIfNeeded(hqAllianceId, ranksChanged);

    if (input.retirePrompt) {
      const retired = await runInteractiveRetires(
        hqAllianceId,
        match,
        input.retirePrompt,
      );
      match = retired.match;
      applyCounts.membersRetired += retired.retired;
    }
  }

  return {
    tag: input.target.tag,
    gameServerNumber: input.target.gameServerNumber,
    lastrankAllianceId: input.target.lastrankAllianceId,
    hqAllianceId,
    allianceCreated,
    lastRankCount: page.members.length,
    match,
    apply: applyCounts,
  };
}
