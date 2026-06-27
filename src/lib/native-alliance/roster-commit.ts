import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { getDb, schema } from "@/lib/db";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import {
  appendMemberGameLevelEventIfChanged,
  appendMemberPowerLevelEventIfChanged,
} from "@/lib/members/member-stat-history.server";
import {
  syncCommanderFromAllianceMember,
  validateRosterImportCommanderIdentities,
} from "@/lib/members/commander-identity.server";
import { CommanderIdentityConflictError } from "@/lib/members/commander-identity-conflicts.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

import { nativeRosterAshedAllianceId } from "./provision";

export type RosterImportCommitRow = {
  extractedName: string;
  matchMemberId: string | null;
  allianceRank: number;
  allianceRankTitle?: string | null;
  heroPowerM?: number | null;
  memberLevel?: number | null;
  powerLevel?: string | null;
  profession?: string | null;
  status?: string | null;
};

export type RosterImportCommitInput = {
  allianceId: string;
  sessionId: string;
  hqUserId: string;
  rows: RosterImportCommitRow[];
  markAbsentInactive?: boolean;
  /** Rank/stat event source — defaults to roster_import. */
  source?: "roster_import" | "video_parse";
};

export type RosterImportCommitResult = {
  created: number;
  updated: number;
  inactivated: number;
  rankEvents: number;
};

function normalizeName(name: string): string {
  return name.trim();
}

async function appendRankEventIfChanged(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  previousRank: number | null;
  previousTitle: string | null;
  allianceRank: number;
  allianceRankTitle?: string | null;
  recordedByHqUserId: string;
  source: "roster_import" | "video_parse";
}): Promise<boolean> {
  const nextTitle = input.allianceRankTitle?.trim() || null;
  if (
    input.previousRank === input.allianceRank &&
    (input.previousTitle ?? null) === nextTitle
  ) {
    return false;
  }

  const db = getDb();
  await db.insert(schema.memberAllianceRankEvents).values({
    id: nanoid(),
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    allianceRank: input.allianceRank,
    allianceRankTitle: nextTitle,
    effectiveDate: getServerCalendarDate(),
    source: input.source,
    recordedByHqUserId: input.recordedByHqUserId,
  });
  return true;
}

async function appendStatEventsForRow(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  powerLevel?: string | null;
  memberLevel?: number | null;
  hqUserId: string;
  source: "roster_import" | "video_parse";
}): Promise<void> {
  if (input.powerLevel) {
    await appendMemberPowerLevelEventIfChanged({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      value: input.powerLevel,
      source: input.source,
      recordedByHqUserId: input.hqUserId,
    });
  }
  if (input.memberLevel != null) {
    await appendMemberGameLevelEventIfChanged({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      value: input.memberLevel,
      source: input.source,
      recordedByHqUserId: input.hqUserId,
    });
  }
}

export async function commitRosterImport(
  input: RosterImportCommitInput,
): Promise<RosterImportCommitResult> {
  if (input.rows.length === 0) {
    throw new Error("No rows to import.");
  }

  const identityConflicts = await validateRosterImportCommanderIdentities({
    allianceId: input.allianceId,
    rows: input.rows.map((row, rowIndex) => ({
      extractedName: row.extractedName,
      matchMemberId: row.matchMemberId,
      rowIndex,
    })),
  });
  if (identityConflicts.length > 0) {
    throw new CommanderIdentityConflictError(identityConflicts);
  }

  const db = getDb();
  const now = new Date();
  const linkedAshedId = await getAshedAllianceIdIfLinked(input.allianceId);
  const ashedAllianceId =
    linkedAshedId ?? nativeRosterAshedAllianceId(input.allianceId);
  const eventSource = input.source ?? "roster_import";
  const auditAction =
    eventSource === "video_parse"
      ? "members.roster_video_commit"
      : "members.roster_import";
  let created = 0;
  let updated = 0;
  let rankEvents = 0;
  const touchedMemberIds = new Set<string>();

  for (const row of input.rows) {
    const name = normalizeName(row.extractedName);
    if (!name) continue;

    if (row.allianceRank < 1 || row.allianceRank > 5) {
      throw new Error(`Invalid rank for ${name}.`);
    }

    if (row.matchMemberId) {
      const [existing] = await db
        .select()
        .from(schema.allianceMembers)
        .where(
          and(
            eq(schema.allianceMembers.allianceId, input.allianceId),
            eq(schema.allianceMembers.ashedMemberId, row.matchMemberId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error(`Matched member not found: ${row.matchMemberId}`);
      }

      touchedMemberIds.add(existing.ashedMemberId);

      const previousNames = existing.previousNamesJson ?? [];
      const nameChanged = existing.currentName !== name;
      const nextPreviousNames =
        nameChanged && !previousNames.includes(existing.currentName)
          ? [...previousNames, existing.currentName]
          : previousNames;

      await db
        .update(schema.allianceMembers)
        .set({
          currentName: name,
          previousNamesJson: nextPreviousNames,
          status: row.status?.trim() || "active",
          allianceRank: row.allianceRank,
          allianceRankTitle: row.allianceRankTitle?.trim() || null,
          ashedRankRaw: formatAshedMemberRankValue(
            row.allianceRank,
            row.allianceRankTitle,
          ),
          heroPowerM: row.heroPowerM ?? existing.heroPowerM,
          memberLevel: row.memberLevel ?? existing.memberLevel,
          powerLevel: row.powerLevel ?? existing.powerLevel,
          profession: row.profession ?? existing.profession,
          syncedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.allianceMembers.id, existing.id));

      if (
        await appendRankEventIfChanged({
          allianceId: input.allianceId,
          ashedMemberId: existing.ashedMemberId,
          memberName: name,
          previousRank: existing.allianceRank,
          previousTitle: existing.allianceRankTitle,
          allianceRank: row.allianceRank,
          allianceRankTitle: row.allianceRankTitle,
          recordedByHqUserId: input.hqUserId,
          source: eventSource,
        })
      ) {
        rankEvents += 1;
      }

      await appendStatEventsForRow({
        allianceId: input.allianceId,
        ashedMemberId: existing.ashedMemberId,
        memberName: name,
        powerLevel: row.powerLevel,
        memberLevel: row.memberLevel,
        hqUserId: input.hqUserId,
        source: eventSource,
      });

      await syncCommanderFromAllianceMember({
        allianceId: input.allianceId,
        ashedMemberId: existing.ashedMemberId,
        memberDisplayName: name,
      });

      updated += 1;
      continue;
    }

    const ashedMemberId = nanoid(16);
    touchedMemberIds.add(ashedMemberId);

    await db.insert(schema.allianceMembers).values({
      id: nanoid(),
      allianceId: input.allianceId,
      ashedMemberId,
      ashedAllianceId,
      currentName: name,
      previousNamesJson: [],
      status: row.status?.trim() || "active",
      allianceRank: row.allianceRank,
      allianceRankTitle: row.allianceRankTitle?.trim() || null,
      ashedRankRaw: formatAshedMemberRankValue(
        row.allianceRank,
        row.allianceRankTitle,
      ),
      heroPowerM: row.heroPowerM ?? null,
      memberLevel: row.memberLevel ?? null,
      powerLevel: row.powerLevel ?? null,
      profession: row.profession ?? null,
      syncedAt: now,
      updatedAt: now,
    });

    await db.insert(schema.memberAllianceRankEvents).values({
      id: nanoid(),
      allianceId: input.allianceId,
      ashedMemberId,
      memberName: name,
      allianceRank: row.allianceRank,
      allianceRankTitle: row.allianceRankTitle?.trim() || null,
      effectiveDate: getServerCalendarDate(),
      source: eventSource,
      recordedByHqUserId: input.hqUserId,
    });
    rankEvents += 1;

    await appendStatEventsForRow({
      allianceId: input.allianceId,
      ashedMemberId,
      memberName: name,
      powerLevel: row.powerLevel,
      memberLevel: row.memberLevel,
      hqUserId: input.hqUserId,
      source: eventSource,
    });

    await syncCommanderFromAllianceMember({
      allianceId: input.allianceId,
      ashedMemberId,
      memberDisplayName: name,
    });
    created += 1;
  }

  let inactivated = 0;
  if (input.markAbsentInactive && touchedMemberIds.size > 0) {
    const activeRows = await db
      .select({ ashedMemberId: schema.allianceMembers.ashedMemberId })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          ne(schema.allianceMembers.status, "former"),
        ),
      );

    const toInactivate = activeRows
      .map((row) => row.ashedMemberId)
      .filter((id) => !touchedMemberIds.has(id));

    if (toInactivate.length > 0) {
      await db
        .update(schema.allianceMembers)
        .set({ status: "former", updatedAt: now })
        .where(
          and(
            eq(schema.allianceMembers.allianceId, input.allianceId),
            inArray(schema.allianceMembers.ashedMemberId, toInactivate),
          ),
        );
      for (const ashedMemberId of toInactivate) {
        await syncCommanderFromAllianceMember({
          allianceId: input.allianceId,
          ashedMemberId,
          leftAt: now,
        });
      }
      inactivated = toInactivate.length;
    }
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: auditAction,
    resourceType: "alliance_members",
    metadata: {
      created,
      updated,
      inactivated,
      rankEvents,
      rowCount: input.rows.length,
    },
  });

  return { created, updated, inactivated, rankEvents };
}
