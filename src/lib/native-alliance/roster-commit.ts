import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import { getServerCalendarDate } from "@/lib/trains/game-time";

import { nativeRosterAshedAllianceId } from "./provision";

export type RosterImportCommitRow = {
  extractedName: string;
  matchMemberId: string | null;
  allianceRank: number;
  allianceRankTitle?: string | null;
  heroPowerM?: number | null;
  memberLevel?: number | null;
};

export type RosterImportCommitInput = {
  allianceId: string;
  sessionId: string;
  hqUserId: string;
  rows: RosterImportCommitRow[];
  markAbsentInactive?: boolean;
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
    source: "roster_import",
    recordedByHqUserId: input.recordedByHqUserId,
  });
  return true;
}

export async function commitRosterImport(
  input: RosterImportCommitInput,
): Promise<RosterImportCommitResult> {
  if (input.rows.length === 0) {
    throw new Error("No rows to import.");
  }

  const db = getDb();
  const now = new Date();
  const ashedAllianceId = nativeRosterAshedAllianceId(input.allianceId);
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
          status: "active",
          allianceRank: row.allianceRank,
          allianceRankTitle: row.allianceRankTitle?.trim() || null,
          ashedRankRaw: formatAshedMemberRankValue(
            row.allianceRank,
            row.allianceRankTitle,
          ),
          heroPowerM: row.heroPowerM ?? existing.heroPowerM,
          memberLevel: row.memberLevel ?? existing.memberLevel,
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
        })
      ) {
        rankEvents += 1;
      }

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
      status: "active",
      allianceRank: row.allianceRank,
      allianceRankTitle: row.allianceRankTitle?.trim() || null,
      ashedRankRaw: formatAshedMemberRankValue(
        row.allianceRank,
        row.allianceRankTitle,
      ),
      heroPowerM: row.heroPowerM ?? null,
      memberLevel: row.memberLevel ?? null,
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
      source: "roster_import",
      recordedByHqUserId: input.hqUserId,
    });
    rankEvents += 1;
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
      inactivated = toInactivate.length;
    }
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: "members.roster_import",
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
