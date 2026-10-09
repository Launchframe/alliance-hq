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
  decideLastRankProfessionApply,
  formatLastRankPowerLevel,
  isLastRankUnranked,
  LASTRANK_PROFESSION_HQ_RECENT_DAYS,
  lastRankMemberEligibleForCreate,
  lastRankPlayerProfileUrl,
  matchLastRankMembersToHq,
  resolveHqNameToRosterRow,
  type LastRankAllianceMember,
  type LastRankHqRosterRow,
  type LastRankInteractiveAnswer,
  type LastRankMatchedRow,
  type LastRankMatchResult,
  type LastRankUnmatchedRow,
} from "@/lib/lastrank/alliance-page.shared";
import type { LastRankSyncTarget } from "@/lib/lastrank/sync-registry.shared";
import {
  emptyLastRankSyncPlan,
  lastRankSyncPlanStats,
  type LastRankSyncPlan,
  type LastRankSyncPlanListener,
} from "@/lib/lastrank/sync-plan.shared";
import {
  createAllianceMemberFromLastRank,
  listActiveMemberIdsNotInSet,
  retireAllianceMembers,
  updateLastRankProfileFields,
  applyInteractiveNameMapping,
  type LastRankUpsertCounts,
} from "@/lib/lastrank/sync-upsert.server";
import {
  loadLastRankAshedWriteContext,
  upsertAllianceAshedCredentialFromConnectionKey,
  type LastRankAshedWriteContext,
} from "@/lib/lastrank/ashed-credential.server";
import {
  buildLastRankRosterDiff,
  type LastRankRosterDiff,
} from "@/lib/lastrank/roster-diff.shared";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup.server";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import {
  appendCommanderPowerLevelEventIfChanged,
  appendMemberProfessionLevelEventIfChanged,
} from "@/lib/members/member-stat-history.server";
import {
  LASTRANK_SYNC_PROFESSION_SOURCE,
  loadLatestProfessionChangeByCommander,
} from "@/lib/professions/repository";
import {
  switchProfession,
  updateCommanderProfession,
} from "@/lib/professions/service";
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
  professionApplied: number;
  professionUnchanged: number;
  /** HQ profession was stale — switched to LastRank's (tears down WL/Eng pairings). */
  professionSwitched: number;
  /** HQ changed profession recently — kept over LastRank's possibly older snapshot. */
  professionConflict: number;
  professionLevelApplied: number;
  professionLevelSkipped: number;
  /** LastRank level is lower than HQ's — treated as stale, not applied. */
  professionLevelConflict: number;
  rankApplied: number;
  rankUnchanged: number;
  rankSkippedMissing: number;
  canonicalWritten: number;
  canonicalSkippedNoUid: number;
  canonicalSkippedMismatch: number;
  canonicalSkippedLookupFailed: number;
  canonicalUnchanged: number;
  namesRenamed: number;
  namesAshedSynced: number;
};

export type LastRankInteractivePrompt = (ctx: {
  lastRankName: string;
  publicId: number;
  profileUrl: string;
  /** True when not in an R1–R5 section — often a recent leaver still listed on LastRank. */
  unranked: boolean;
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
  rosterDiff: LastRankRosterDiff;
  ashedCredentialSaved: boolean;
  ashedDualWrite: boolean;
  apply: LastRankSyncApplyCounts | null;
};

function isHqProfession(
  value: string | null,
): value is "Engineer" | "War Leader" {
  return value === "Engineer" || value === "War Leader";
}

function emptyApplyCounts(): LastRankSyncApplyCounts {
  return {
    membersCreated: 0,
    membersRetired: 0,
    profileUpdated: 0,
    ashedMembersCreated: 0,
    ashedMembersRetired: 0,
    ashedSkipped: 0,
    thpApplied: 0,
    thpSkipped: 0,
    thpConflict: 0,
    levelApplied: 0,
    levelSkipped: 0,
    levelConflict: 0,
    powerUpdated: 0,
    professionApplied: 0,
    professionUnchanged: 0,
    professionSwitched: 0,
    professionConflict: 0,
    professionLevelApplied: 0,
    professionLevelSkipped: 0,
    professionLevelConflict: 0,
    rankApplied: 0,
    rankUnchanged: 0,
    rankSkippedMissing: 0,
    canonicalWritten: 0,
    canonicalSkippedNoUid: 0,
    canonicalSkippedMismatch: 0,
    canonicalSkippedLookupFailed: 0,
    canonicalUnchanged: 0,
    namesRenamed: 0,
    namesAshedSynced: 0,
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
      hqProfession: schema.commanders.profession,
      hqProfessionLevel: schema.commanders.professionalLevel,
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
    hqProfession: row.hqProfession,
    hqProfessionLevel: row.hqProfessionLevel,
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
  onProgress?: (done: number, total: number) => void,
): Promise<boolean> {
  const db = getDb();
  const effectiveDate = getServerCalendarDate();
  let ranksChanged = false;
  const professionChangedAt = await loadLatestProfessionChangeByCommander(
    rows.map((row) => row.hq.commanderId),
  );
  // Profession switches tear down alliance pairings; keep them one at a time.
  let professionLock: Promise<void> = Promise.resolve();
  const serializeProfession = (fn: () => Promise<void>): Promise<void> => {
    const next = professionLock.then(fn);
    professionLock = next.catch(() => undefined);
    return next;
  };

  const applyRow = async (row: LastRankMatchedRow): Promise<void> => {
    // Belt-and-suspenders: sole fuzzy auto-match is refused in
    // matchLastRankMembersToHq; never write ranks/public ids from fuzzy rows.
    if (
      row.matchMethod === "fuzzy_current" ||
      row.matchMethod === "fuzzy_previous"
    ) {
      return;
    }

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

    await serializeProfession(() => applyRowProfession(row));
  };

  const applyRowProfession = async (row: LastRankMatchedRow): Promise<void> => {
    const professionDecision = decideLastRankProfessionApply(
      row.hq,
      row.lastRank,
      { hqProfessionChangedAt: professionChangedAt.get(row.hq.commanderId) ?? null },
    );
    const lastRankProfession = row.lastRank.profession;
    const priorProfession = row.hq.hqProfession;
    if (
      lastRankProfession &&
      (professionDecision.profession === "apply" ||
        (professionDecision.profession === "switch" &&
          !isHqProfession(priorProfession)))
    ) {
      await updateCommanderProfession(
        row.hq.commanderId,
        lastRankProfession,
        hqAllianceId,
      );
      row.hq.hqProfession = lastRankProfession;
      counts.professionApplied += 1;
    } else if (
      lastRankProfession &&
      professionDecision.profession === "switch" &&
      isHqProfession(priorProfession)
    ) {
      await switchProfession({
        allianceId: hqAllianceId,
        commanderId: row.hq.commanderId,
        fromProfession: priorProfession,
        toProfession: lastRankProfession,
        source: LASTRANK_SYNC_PROFESSION_SOURCE,
      });
      row.hq.hqProfession = lastRankProfession;
      counts.professionSwitched += 1;
      console.error(
        `Profession switched: ${row.lastRank.name} ${priorProfession} → ${lastRankProfession} (HQ entry older than ${LASTRANK_PROFESSION_HQ_RECENT_DAYS} days).`,
      );
    } else if (professionDecision.profession === "unchanged") {
      counts.professionUnchanged += 1;
    } else if (professionDecision.profession === "conflict") {
      counts.professionConflict += 1;
      console.error(
        `Profession kept: ${row.lastRank.name} is ${lastRankProfession} on LastRank but changed to ${priorProfession} in HQ within ${LASTRANK_PROFESSION_HQ_RECENT_DAYS} days.`,
      );
    }

    const professionLevel = row.lastRank.professionLevel;
    if (professionDecision.level === "apply" && professionLevel != null) {
      await db
        .update(schema.commanders)
        .set({ professionalLevel: professionLevel, updatedAt: new Date() })
        .where(eq(schema.commanders.id, row.hq.commanderId));
      await appendMemberProfessionLevelEventIfChanged({
        allianceId: hqAllianceId,
        ashedMemberId: row.hq.ashedMemberId,
        memberName: row.lastRank.name,
        value: professionLevel,
        source: "lastrank_sync",
        recordedDate: effectiveDate,
      });
      row.hq.hqProfessionLevel = professionLevel;
      counts.professionLevelApplied += 1;
    } else if (professionDecision.level === "conflict") {
      counts.professionLevelConflict += 1;
    } else {
      counts.professionLevelSkipped += 1;
    }
  };

  await runWithConcurrency(rows, LASTRANK_APPLY_CONCURRENCY, applyRow, onProgress);
  return ranksChanged;
}

/** Below the app pool size (5) so the batch never starves other queries. */
const LASTRANK_APPLY_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let next = 0;
  let done = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
      done += 1;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
}

async function persistInteractiveMatchMapping(
  row: LastRankMatchedRow,
  counts: LastRankSyncApplyCounts,
): Promise<void> {
  if (await updateLastRankProfileFields(row.hq.commanderId, row.lastRank)) {
    counts.profileUpdated += 1;
  }
}

function emitPlan(
  plan: LastRankSyncPlan,
  remaining: number,
  listener: LastRankSyncPlanListener | undefined,
): void {
  listener?.(lastRankSyncPlanStats(plan, remaining));
}

/** Prompts only queue decisions on `plan`; nothing is written until dispatch. */
async function runInteractiveResolutions(
  match: LastRankMatchResult,
  prompt: LastRankInteractivePrompt,
  plan: LastRankSyncPlan,
  options: {
    apply: boolean;
    onPlanChanged?: LastRankSyncPlanListener;
  },
): Promise<LastRankMatchResult> {
  let current = match;
  const claimed = new Set(match.matched.map((row) => row.hq.commanderId));
  const allHq = [
    ...match.matched.map((row) => row.hq),
    ...match.unmatchedHq,
  ];
  const pending = match.unmatched.filter(
    (row) => row.status === "unmatched" || row.status === "ambiguous",
  );

  for (const [index, row] of pending.entries()) {
    const remainingHqNames = allHq
      .filter((hq) => !claimed.has(hq.commanderId))
      .map((hq) => hq.currentNames[0] ?? hq.previousNames[0] ?? hq.commanderId);

    const answer = await prompt({
      lastRankName: row.lastRank.name,
      publicId: row.lastRank.publicId,
      profileUrl: lastRankPlayerProfileUrl(row.lastRank.publicId),
      unranked: isLastRankUnranked(row.lastRank),
      suggestions: row.suggestions,
      remainingHqNames,
    });
    const remaining = pending.length - index - 1;

    if (answer.kind === "skip") {
      plan.skipped += 1;
      emitPlan(plan, remaining, options.onPlanChanged);
      continue;
    }

    if (answer.kind === "create") {
      if (!options.apply) {
        console.error(
          `Create skipped for "${row.lastRank.name}" (re-run with --apply to create HQ members).`,
        );
        plan.skipped += 1;
      } else if (!lastRankMemberEligibleForCreate(row.lastRank)) {
        console.error(
          `Create skipped for "${row.lastRank.name}" (unranked — often a leaver; leave blank to skip).`,
        );
        plan.skipped += 1;
      } else {
        plan.creates.push(row.lastRank);
      }
      emitPlan(plan, remaining, options.onPlanChanged);
      continue;
    }

    const resolved = resolveHqNameToRosterRow(answer.hqName, allHq, claimed);
    if (!resolved.ok) {
      console.error(
        `Could not map "${row.lastRank.name}" → "${answer.hqName}" (${resolved.reason})`,
      );
      plan.skipped += 1;
      emitPlan(plan, remaining, options.onPlanChanged);
      continue;
    }
    claimed.add(resolved.hq.commanderId);
    current = applyInteractiveMatches(current, [
      { lastRankPublicId: row.lastRank.publicId, hq: resolved.hq },
    ]);
    const matchedRow = current.matched.find(
      (matched) =>
        matched.matchMethod === "interactive" &&
        matched.lastRank.publicId === row.lastRank.publicId,
    );
    if (matchedRow) {
      plan.mapped.push({
        row: matchedRow,
        priorHqName:
          matchedRow.hq.currentNames[0] ??
          matchedRow.hq.previousNames[0] ??
          matchedRow.hq.commanderId,
      });
    }
    emitPlan(plan, remaining, options.onPlanChanged);
  }

  return current;
}

/** Creates HQ members for interactively queued LastRank rows. */
async function createQueuedLastRankMembers(
  hqAllianceId: string,
  gameServerNumber: number,
  match: LastRankMatchResult,
  queued: LastRankAllianceMember[],
  ashed: LastRankAshedWriteContext | null,
): Promise<{ match: LastRankMatchResult; created: number; ashedCreated: number }> {
  let current = match;
  let created = 0;
  let ashedCreated = 0;
  for (const lastRank of queued) {
    const result = await createAllianceMemberFromLastRank({
      allianceId: hqAllianceId,
      gameServerNumber,
      lastRank,
      ashed,
    });
    created += 1;
    if (result.ashedCreated) ashedCreated += 1;
    current = applyInteractiveMatches(current, [
      { lastRankPublicId: lastRank.publicId, hq: result.hq },
    ]);
    console.error(
      `Created: ${lastRank.name}${result.ashedCreated ? " (Ashed+HQ)" : " (HQ only)"}`,
    );
  }
  return { match: current, created, ashedCreated };
}

async function createUnmatchedLastRankMembers(
  hqAllianceId: string,
  gameServerNumber: number,
  match: LastRankMatchResult,
  ashed: LastRankAshedWriteContext | null,
): Promise<{
  match: LastRankMatchResult;
  created: number;
  ashedCreated: number;
}> {
  let created = 0;
  let ashedCreated = 0;
  const matched = [...match.matched];
  const stillUnmatched: LastRankMatchResult["unmatched"] = [];

  for (const row of match.unmatched) {
    if (row.status !== "unmatched") {
      stillUnmatched.push(row);
      continue;
    }
    if (!lastRankMemberEligibleForCreate(row.lastRank)) {
      stillUnmatched.push(row);
      console.error(
        `Create skipped: ${row.lastRank.name} (unranked on LastRank — often a recent leaver).`,
      );
      continue;
    }
    const result = await createAllianceMemberFromLastRank({
      allianceId: hqAllianceId,
      gameServerNumber,
      lastRank: row.lastRank,
      ashed,
    });
    created += 1;
    if (result.ashedCreated) ashedCreated += 1;
    matched.push({
      status: "matched",
      lastRank: row.lastRank,
      hq: result.hq,
      matchMethod: "interactive",
      fuzzyScore: null,
    });
    console.error(
      `Created: ${row.lastRank.name}${result.ashedCreated ? " (Ashed+HQ)" : " (HQ only)"}`,
    );
  }

  const matchedIds = new Set(matched.map((row) => row.hq.commanderId));
  return {
    created,
    ashedCreated,
    match: {
      matched,
      unmatched: stillUnmatched,
      unmatchedHq: match.unmatchedHq.filter(
        (row) => !matchedIds.has(row.commanderId),
      ),
    },
  };
}

/** Queues retire choices on `plan`; nothing is written until dispatch. */
async function runInteractiveRetires(
  hqAllianceId: string,
  match: LastRankMatchResult,
  prompt: LastRankRetirePrompt,
  plan: LastRankSyncPlan,
  onPlanChanged: LastRankSyncPlanListener | undefined,
): Promise<void> {
  const keepIds = new Set(match.matched.map((row) => row.hq.ashedMemberId));
  const candidates = await listActiveMemberIdsNotInSet(hqAllianceId, keepIds);

  for (const [index, member] of candidates.entries()) {
    const shouldRetire = await prompt({
      memberName: member.currentName,
      ashedMemberId: member.ashedMemberId,
    });
    if (shouldRetire) {
      plan.retires.push({
        ashedMemberId: member.ashedMemberId,
        memberName: member.currentName,
      });
    }
    emitPlan(plan, candidates.length - index - 1, onPlanChanged);
  }
}

async function dispatchQueuedRetires(
  hqAllianceId: string,
  match: LastRankMatchResult,
  retires: LastRankSyncPlan["retires"],
  ashed: LastRankAshedWriteContext | null,
): Promise<{
  match: LastRankMatchResult;
  retired: number;
  ashedRetired: number;
  ashedSkipped: number;
}> {
  if (retires.length === 0) {
    return { match, retired: 0, ashedRetired: 0, ashedSkipped: 0 };
  }
  const ids = new Set(retires.map((row) => row.ashedMemberId));
  const result = await retireAllianceMembers({
    allianceId: hqAllianceId,
    ashedMemberIds: [...ids],
    ashed,
  });
  for (const member of retires) {
    console.error(`Retired: ${member.memberName}`);
  }
  return {
    retired: result.retired,
    ashedRetired: result.ashedRetired,
    ashedSkipped: result.ashedSkipped,
    match: {
      ...match,
      unmatchedHq: match.unmatchedHq.filter((row) => !ids.has(row.ashedMemberId)),
    },
  };
}

async function runRetireAll(
  hqAllianceId: string,
  match: LastRankMatchResult,
  ashed: LastRankAshedWriteContext | null,
): Promise<{
  match: LastRankMatchResult;
  retired: number;
  ashedRetired: number;
  ashedSkipped: number;
}> {
  const keepIds = new Set(match.matched.map((row) => row.hq.ashedMemberId));
  const candidates = await listActiveMemberIdsNotInSet(hqAllianceId, keepIds);
  if (candidates.length === 0) {
    return { match, retired: 0, ashedRetired: 0, ashedSkipped: 0 };
  }

  const result = await retireAllianceMembers({
    allianceId: hqAllianceId,
    ashedMemberIds: candidates.map((row) => row.ashedMemberId),
    ashed,
  });
  for (const member of candidates) {
    console.error(`Retired: ${member.currentName}`);
  }

  return {
    retired: result.retired,
    ashedRetired: result.ashedRetired,
    ashedSkipped: result.ashedSkipped,
    match: {
      ...match,
      unmatchedHq: [],
    },
  };
}

export async function syncLastRankAlliance(input: {
  target: LastRankSyncTarget;
  apply: boolean;
  /** After matching (and optional interactive), create HQ members for remaining unmatched LastRank rows. */
  createAllUnmatched?: boolean;
  /** Retire all active HQ members missing from LastRank (no prompts). */
  retireAllUnmatched?: boolean;
  /** Ashed connection key — upserts alliance bot credential when saving is allowed. */
  ashedConnectionKey?: string;
  /** Persist connection key even on dry-run. */
  saveAshedCredential?: boolean;
  /** Force HQ-only writes (skip Ashed POST/PUT even if bot JWT exists). */
  hqOnly?: boolean;
  interactivePrompt?: LastRankInteractivePrompt;
  alliancePrompt?: LastRankAllianceResolvePrompt;
  retirePrompt?: LastRankRetirePrompt;
  /** Called after every interactive answer with the queued (unwritten) plan. */
  onPlanChanged?: LastRankSyncPlanListener;
  /** Called once prompts finish, just before any queued writes run. */
  onDispatchStart?: LastRankSyncPlanListener;
}): Promise<LastRankAllianceSyncResult> {
  const { allianceId: hqAllianceId, created: allianceCreated } =
    await resolveHqAllianceForLastRankSync({
      target: input.target,
      allowCreate: input.apply,
      alliancePrompt: input.alliancePrompt,
    });

  let ashedCredentialSaved = false;
  const shouldSaveCredential =
    Boolean(input.ashedConnectionKey?.trim()) &&
    (input.apply || Boolean(input.saveAshedCredential));
  if (shouldSaveCredential && input.ashedConnectionKey) {
    const saved = await upsertAllianceAshedCredentialFromConnectionKey({
      hqAllianceId,
      allianceTag: input.target.tag,
      connectionKey: input.ashedConnectionKey,
    });
    if (!saved.ok) {
      throw new Error(saved.error);
    }
    ashedCredentialSaved = true;
    console.error(
      `Saved alliance Ashed bot credential for ${input.target.tag}.`,
    );
  }

  const ashed = input.hqOnly
    ? null
    : await loadLastRankAshedWriteContext(hqAllianceId);
  if (input.hqOnly) {
    console.error("Ashed dual-write forced off (--hq-only).");
  } else if (input.apply && (input.createAllUnmatched || input.retireAllUnmatched)) {
    if (ashed) {
      console.error(
        `Ashed dual-write enabled (alliance ${ashed.ashedAllianceId}).`,
      );
    } else {
      console.error(
        "Ashed dual-write skipped (alliance not Ashed-linked or no bot credential).",
      );
    }
  }

  const page = await fetchLastRankAlliancePage(input.target.lastrankAllianceId);
  const hqRows = await loadHqRosterForLastRankMatch(hqAllianceId);
  let match = matchLastRankMembersToHq(page.members, hqRows);

  const trackApply =
    input.apply || Boolean(input.interactivePrompt);
  const applyCounts: LastRankSyncApplyCounts | null = trackApply
    ? emptyApplyCounts()
    : null;

  // Interactive answers only queue decisions; writes happen in one dispatch
  // below so each prompt does not wait on remote DB / Ashed round trips.
  const plan = emptyLastRankSyncPlan();
  if (input.interactivePrompt && match.unmatched.length > 0) {
    match = await runInteractiveResolutions(match, input.interactivePrompt, plan, {
      apply: input.apply,
      onPlanChanged: input.onPlanChanged,
    });
  }
  if (input.apply && !input.retireAllUnmatched && input.retirePrompt) {
    await runInteractiveRetires(
      hqAllianceId,
      match,
      input.retirePrompt,
      plan,
      input.onPlanChanged,
    );
  }

  // Diff before create/retire so operators see excess/missing even on --apply.
  const rosterDiff = buildLastRankRosterDiff({
    lastRankCount: page.members.length,
    match,
  });

  input.onDispatchStart?.(lastRankSyncPlanStats(plan, 0));

  if (!input.apply && applyCounts && plan.mapped.length > 0) {
    await runWithConcurrency(
      plan.mapped,
      LASTRANK_APPLY_CONCURRENCY,
      async ({ row, priorHqName }) => {
        await persistInteractiveMatchMapping(row, applyCounts);
        console.error(
          `Saved mapping: ${row.lastRank.name} → ${priorHqName} (lastrank_public_id only; re-run with --apply to rename HQ/Ashed)`,
        );
      },
    );
  }

  if (input.apply && applyCounts) {
    for (const { row, priorHqName } of plan.mapped) {
      const nameResult = await applyInteractiveNameMapping({
        allianceId: hqAllianceId,
        ashedMemberId: row.hq.ashedMemberId,
        commanderId: row.hq.commanderId,
        lastRankName: row.lastRank.name,
        ashed,
      });
      if (nameResult.renamed) applyCounts.namesRenamed += 1;
      if (nameResult.ashedSynced) applyCounts.namesAshedSynced += 1;
      if (nameResult.canonicalWritten) {
        applyCounts.canonicalWritten += 1;
        row.hq.existingCanonicalName = row.lastRank.name;
      }
      console.error(
        `Saved: ${priorHqName} → ${row.lastRank.name} (lastrank_public_id=${row.lastRank.publicId})`,
      );
    }

    if (plan.creates.length > 0) {
      const created = await createQueuedLastRankMembers(
        hqAllianceId,
        input.target.gameServerNumber,
        match,
        plan.creates,
        ashed,
      );
      match = created.match;
      applyCounts.membersCreated += created.created;
      applyCounts.ashedMembersCreated += created.ashedCreated;
      if (ashed && created.created > created.ashedCreated) {
        applyCounts.ashedSkipped += created.created - created.ashedCreated;
      }
    }

    if (input.createAllUnmatched) {
      const created = await createUnmatchedLastRankMembers(
        hqAllianceId,
        input.target.gameServerNumber,
        match,
        ashed,
      );
      match = created.match;
      applyCounts.membersCreated += created.created;
      applyCounts.ashedMembersCreated += created.ashedCreated;
      if (ashed && created.created > created.ashedCreated) {
        applyCounts.ashedSkipped += created.created - created.ashedCreated;
      }
    }

    const partial = emptyApplyCounts();
    const progressEvery = Math.max(10, Math.ceil(match.matched.length / 10));
    const ranksChanged = await applyMatchedRows(
      hqAllianceId,
      match.matched,
      partial,
      (done, total) => {
        if (done % progressEvery === 0 || done === total) {
          console.error(`Updated ${done}/${total} matched members…`);
        }
      },
    );
    mergeApplyCounts(applyCounts, partial);
    await syncRankPoolIfNeeded(hqAllianceId, ranksChanged);

    if (input.retireAllUnmatched) {
      const retired = await runRetireAll(hqAllianceId, match, ashed);
      match = retired.match;
      applyCounts.membersRetired += retired.retired;
      applyCounts.ashedMembersRetired += retired.ashedRetired;
      applyCounts.ashedSkipped += retired.ashedSkipped;
    } else if (plan.retires.length > 0) {
      const retired = await dispatchQueuedRetires(
        hqAllianceId,
        match,
        plan.retires,
        ashed,
      );
      match = retired.match;
      applyCounts.membersRetired += retired.retired;
      applyCounts.ashedMembersRetired += retired.ashedRetired;
      applyCounts.ashedSkipped += retired.ashedSkipped;
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
    rosterDiff,
    ashedCredentialSaved,
    ashedDualWrite: ashed != null,
    apply: applyCounts,
  };
}
