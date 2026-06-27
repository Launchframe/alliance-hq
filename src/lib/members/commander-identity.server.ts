import "server-only";

/**
 * Commander identity — stats, alliance memberships, HQ ownership.
 *
 * UID is preferred when known; orphan Commanders use normalized name + game server.
 * Name collisions defer sync and surface officer resolution (never silent merge).
 */

import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type {
  Commander,
  CommanderAllianceMembership,
} from "@/lib/db/schema";
import {
  COMMANDER_SYNC_STATUS,
  type CommanderConflictReasonJson,
  type CommanderIdentityConflict,
  type CommanderSyncStatus,
  detectBatchNameConflicts,
  normalizeCommanderName,
  type RosterImportNameRow,
} from "@/lib/members/commander-identity-conflicts.shared";

type AllianceMemberRow = typeof schema.allianceMembers.$inferSelect;

export type CommanderSyncResult =
  | { status: "synced"; commanderId: string }
  | {
      status: "deferred";
      reason: CommanderSyncStatus;
      conflict?: CommanderIdentityConflict;
    };

function normalizeGameUid(gameUid: string): string | null {
  const trimmed = gameUid.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function commanderStatsFromMemberRow(
  memberRow: AllianceMemberRow | null | undefined,
  fallbackName?: string | null,
) {
  const primaryName = memberRow?.currentName ?? fallbackName ?? null;
  return {
    primaryName,
    primaryNameNormalized: primaryName
      ? normalizeCommanderName(primaryName)
      : null,
    profession: memberRow?.profession ?? null,
    professionalLevel: memberRow?.professionalLevel ?? null,
    memberLevel: memberRow?.memberLevel ?? null,
    heroPowerM: memberRow?.heroPowerM ?? null,
    powerLevel: memberRow?.powerLevel ?? null,
    currentKills: memberRow?.currentKills ?? null,
    currentTotalHeroPower: memberRow?.currentTotalHeroPower ?? null,
    currentSquadPowerJson: memberRow?.currentSquadPowerJson ?? null,
  };
}

async function loadAllianceMemberRow(
  allianceId: string,
  ashedMemberId: string,
): Promise<AllianceMemberRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function resolveAllianceGameServerNumber(
  allianceId: string,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({ gameServerNumber: schema.alliances.gameServerNumber })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.gameServerNumber ?? null;
}

async function resolveGameUidForMember(
  allianceId: string,
  ashedMemberId: string,
  memberRow?: AllianceMemberRow | null,
): Promise<string | null> {
  const fromRow = memberRow?.gameUid?.trim();
  if (fromRow) return fromRow;

  const db = getDb();
  const [hqLink] = await db
    .select({ gameUid: schema.hqMemberLinks.gameUid })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  if (hqLink?.gameUid?.trim()) {
    return hqLink.gameUid.trim();
  }

  const [discordLink] = await db
    .select({ gameUid: schema.discordMemberLinks.gameUid })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, allianceId),
        eq(schema.discordMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return discordLink?.gameUid?.trim() ?? null;
}

async function setMemberCommanderSyncStatus(
  allianceId: string,
  ashedMemberId: string,
  status: CommanderSyncStatus,
  conflict?: CommanderConflictReasonJson | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.allianceMembers)
    .set({
      commanderSyncStatus: status,
      commanderConflictJson: conflict ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    );
}

/**
 * Find an orphan commander (game_uid IS NULL) matching the given normalized
 * name + server, scoped to the current alliance's CAM.
 *
 * The leftJoin filters CAM rows to `allianceId` only:
 * - `ashedMemberId` is non-null  → this alliance already owns the commander
 *   (same member re-syncing, or a collision needing conflict handling).
 * - `ashedMemberId` is null      → either (a) no CAM exists at all, or (b) the
 *   commander was created by a *different* alliance on the same server.
 *
 * Both null cases are treated as "adoptable" by the caller because Last War
 * names are server-unique: same normalizedName + gameServerNumber implies the
 * same physical player.  The same-alliance conflict check (findNameTakenByOtherMember)
 * is deliberately skipped when this function returns a row, because a
 * same-alliance duplicate would already surface via `ashedMemberId !== null`.
 */
async function findOrphanCommanderByNameServer(input: {
  allianceId: string;
  normalizedName: string;
  gameServerNumber: number;
}): Promise<{
  commander: Commander;
  ashedMemberId: string | null;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      commander: schema.commanders,
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
    })
    .from(schema.commanders)
    .leftJoin(
      schema.commanderAllianceMemberships,
      and(
        eq(
          schema.commanderAllianceMemberships.commanderId,
          schema.commanders.id,
        ),
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
      ),
    )
    .where(
      and(
        isNull(schema.commanders.gameUid),
        eq(schema.commanders.primaryNameNormalized, input.normalizedName),
        eq(schema.commanders.gameServerNumber, input.gameServerNumber),
      ),
    )
    .limit(1);

  if (!row) return null;
  return { commander: row.commander, ashedMemberId: row.ashedMemberId };
}

export async function findNameTakenByOtherMember(input: {
  allianceId: string;
  normalizedName: string;
  gameServerNumber: number;
  excludeAshedMemberId?: string | null;
}): Promise<CommanderIdentityConflict | null> {
  const db = getDb();
  const conditions = [
    isNull(schema.commanders.gameUid),
    eq(schema.commanders.primaryNameNormalized, input.normalizedName),
    eq(schema.commanders.gameServerNumber, input.gameServerNumber),
    eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
  ];
  if (input.excludeAshedMemberId) {
    conditions.push(
      ne(
        schema.commanderAllianceMemberships.ashedMemberId,
        input.excludeAshedMemberId,
      ),
    );
  }

  const [row] = await db
    .select({
      commanderId: schema.commanders.id,
      memberName: schema.allianceMembers.currentName,
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
    })
    .from(schema.commanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(
        schema.commanderAllianceMemberships.commanderId,
        schema.commanders.id,
      ),
    )
    .innerJoin(
      schema.allianceMembers,
      and(
        eq(
          schema.allianceMembers.allianceId,
          schema.commanderAllianceMemberships.allianceId,
        ),
        eq(
          schema.allianceMembers.ashedMemberId,
          schema.commanderAllianceMemberships.ashedMemberId,
        ),
      ),
    )
    .where(and(...conditions))
    .limit(1);

  if (!row) return null;

  return {
    code: "name_taken_by_other_member",
    ashedMemberId: input.excludeAshedMemberId ?? undefined,
    normalizedName: input.normalizedName,
    gameServerNumber: input.gameServerNumber,
    existingCommanderId: row.commanderId,
    existingMemberName: row.memberName,
  };
}

export async function validateRosterImportCommanderIdentities(input: {
  allianceId: string;
  rows: RosterImportNameRow[];
}): Promise<CommanderIdentityConflict[]> {
  const gameServerNumber = await resolveAllianceGameServerNumber(input.allianceId);
  if (gameServerNumber == null) {
    return [];
  }

  const batchConflicts = detectBatchNameConflicts(input.rows, gameServerNumber);
  if (batchConflicts.length > 0) {
    return batchConflicts;
  }

  const crossConflicts: CommanderIdentityConflict[] = [];
  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const normalizedName = normalizeCommanderName(row.extractedName);
    if (!normalizedName) continue;

    const conflict = await findNameTakenByOtherMember({
      allianceId: input.allianceId,
      normalizedName,
      gameServerNumber,
      excludeAshedMemberId: row.matchMemberId,
    });
    if (conflict) {
      crossConflicts.push({ ...conflict, rowIndex: row.rowIndex ?? i });
    }
  }

  return crossConflicts;
}

export async function listCommanderIdentityConflictsForAlliance(
  allianceId: string,
): Promise<CommanderIdentityConflict[]> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      commanderConflictJson: schema.allianceMembers.commanderConflictJson,
      gameServerNumber: schema.alliances.gameServerNumber,
    })
    .from(schema.allianceMembers)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.allianceMembers.allianceId),
    )
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(
          schema.allianceMembers.commanderSyncStatus,
          COMMANDER_SYNC_STATUS.NAME_CONFLICT,
        ),
      ),
    );

  return rows.flatMap((row): CommanderIdentityConflict[] => {
    const json = row.commanderConflictJson as CommanderConflictReasonJson | null;

    if (row.gameServerNumber == null) {
      // A name_conflict without a server number is an inconsistent DB state
      // (name conflicts are only raised when a server is known). Skip rather
      // than synthesize a conflict with gameServerNumber: 0, which is not a
      // valid Last War server and would mislead conflict resolution UI.
      return [];
    }

    if (!json?.normalizedName) {
      return [
        {
          code: "name_taken_by_other_member" as const,
          ashedMemberId: row.ashedMemberId,
          normalizedName: normalizeCommanderName(row.currentName),
          gameServerNumber: row.gameServerNumber,
        },
      ];
    }
    return [
      {
        code: json.code,
        ashedMemberId: row.ashedMemberId,
        normalizedName: json.normalizedName,
        gameServerNumber: json.gameServerNumber,
        existingCommanderId: json.existingCommanderId,
        existingMemberName: json.existingMemberName,
      },
    ];
  });
}

export async function listCommanderTenureHistoryByGameUid(gameUid: string) {
  const normalized = normalizeGameUid(gameUid);
  if (!normalized) return [];

  const db = getDb();
  return db
    .select({
      id: schema.commanderAllianceMemberships.id,
      gameUid: schema.commanders.gameUid,
      allianceId: schema.commanderAllianceMemberships.allianceId,
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
      joinedAt: schema.commanderAllianceMemberships.joinedAt,
      leftAt: schema.commanderAllianceMemberships.leftAt,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanderAllianceMemberships.commanderId, schema.commanders.id),
    )
    .innerJoin(
      schema.alliances,
      eq(schema.commanderAllianceMemberships.allianceId, schema.alliances.id),
    )
    .where(eq(schema.commanders.gameUid, normalized))
    .orderBy(desc(schema.commanderAllianceMemberships.joinedAt))
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        gameUid: row.gameUid ?? normalized,
      })),
    );
}

export async function resolveCommanderByUid(
  gameUid: string,
): Promise<Commander | null> {
  const normalized = normalizeGameUid(gameUid);
  if (!normalized) return null;

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.commanders)
    .where(eq(schema.commanders.gameUid, normalized))
    .limit(1);
  return row ?? null;
}

export async function resolveActiveCommanderMembership(
  commanderId: string,
  allianceId: string,
): Promise<CommanderAllianceMembership | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.commanderId, commanderId),
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function upsertCommanderRow(input: {
  gameUid?: string | null;
  gameServerNumber?: number | null;
  allianceId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  existingCommanderId?: string | null;
}): Promise<{ commanderId: string }> {
  const db = getDb();
  const now = new Date();
  const memberRow = await loadAllianceMemberRow(
    input.allianceId,
    input.ashedMemberId,
  );
  const stats = commanderStatsFromMemberRow(memberRow, input.memberDisplayName);
  const normalizedUid = input.gameUid ? normalizeGameUid(input.gameUid) : null;

  if (normalizedUid) {
    const existing = await resolveCommanderByUid(normalizedUid);
    if (existing) {
      await db
        .update(schema.commanders)
        .set({
          ...stats,
          gameServerNumber:
            input.gameServerNumber ?? existing.gameServerNumber ?? null,
          updatedAt: now,
        })
        .where(eq(schema.commanders.id, existing.id));
      return { commanderId: existing.id };
    }
  }

  if (input.existingCommanderId) {
    await db
      .update(schema.commanders)
      .set({
        ...stats,
        gameUid: normalizedUid,
        gameServerNumber: input.gameServerNumber ?? null,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, input.existingCommanderId));
    return { commanderId: input.existingCommanderId };
  }

  const [row] = await db
    .insert(schema.commanders)
    .values({
      id: nanoid(),
      gameUid: normalizedUid,
      gameServerNumber: input.gameServerNumber ?? null,
      ...stats,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.commanders.id });

  if (!row) {
    throw new Error("commander_identity_insert_failed");
  }

  return { commanderId: row.id };
}

export async function upsertCommanderFromLink(input: {
  gameUid: string;
  allianceId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
}): Promise<{ commanderId: string }> {
  const normalized = normalizeGameUid(input.gameUid);
  if (!normalized) {
    throw new Error("commander_identity_missing_game_uid");
  }

  const gameServerNumber = await resolveAllianceGameServerNumber(input.allianceId);
  const memberRow = await loadAllianceMemberRow(
    input.allianceId,
    input.ashedMemberId,
  );
  const normalizedName = normalizeCommanderName(
    memberRow?.currentName ?? input.memberDisplayName ?? "",
  );

  let existingCommanderId: string | null = null;
  if (normalizedName && gameServerNumber != null) {
    const orphan = await findOrphanCommanderByNameServer({
      allianceId: input.allianceId,
      normalizedName,
      gameServerNumber,
    });
    if (orphan && orphan.ashedMemberId === input.ashedMemberId) {
      existingCommanderId = orphan.commander.id;
    } else if (orphan && orphan.ashedMemberId == null) {
      existingCommanderId = orphan.commander.id;
    }
  }

  return upsertCommanderRow({
    gameUid: normalized,
    gameServerNumber,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.memberDisplayName,
    existingCommanderId,
  });
}

export async function upsertCommanderAllianceMembership(input: {
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  joinedAt?: Date;
  leftAt?: Date | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  const memberRow = await loadAllianceMemberRow(
    input.allianceId,
    input.ashedMemberId,
  );

  const [existing] = await db
    .select()
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        eq(schema.commanderAllianceMemberships.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  const status =
    input.leftAt != null
      ? "former"
      : memberRow?.status === "active"
        ? "active"
        : "former";
  const joinedAt = input.joinedAt ?? existing?.joinedAt ?? now;
  const leftAt =
    input.leftAt !== undefined
      ? input.leftAt
      : memberRow?.status === "active"
        ? null
        : (existing?.leftAt ?? now);

  const membershipValues = {
    commanderId: input.commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    ashedAllianceId: memberRow?.ashedAllianceId ?? null,
    status,
    joinedAt,
    leftAt,
    allianceRank: memberRow?.allianceRank ?? null,
    allianceRankTitle: memberRow?.allianceRankTitle ?? null,
    rosterNameAtMembership:
      memberRow?.currentName ?? input.memberDisplayName ?? null,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(schema.commanderAllianceMemberships)
      .set(membershipValues)
      .where(eq(schema.commanderAllianceMemberships.id, existing.id));
    return;
  }

  await db.insert(schema.commanderAllianceMemberships).values({
    id: nanoid(),
    ...membershipValues,
    createdAt: now,
  });
}

export async function linkHqUserToCommander(input: {
  hqUserId: string;
  commanderId: string;
  setPrimary?: boolean;
  linkedAt?: Date;
}): Promise<void> {
  const db = getDb();
  const now = input.linkedAt ?? new Date();

  if (input.setPrimary !== false) {
    await db
      .update(schema.hqUserCommanders)
      .set({ isPrimary: false, updatedAt: now })
      .where(eq(schema.hqUserCommanders.hqUserId, input.hqUserId));
  }

  await db
    .insert(schema.hqUserCommanders)
    .values({
      id: nanoid(),
      hqUserId: input.hqUserId,
      commanderId: input.commanderId,
      isPrimary: input.setPrimary !== false,
      linkedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.hqUserCommanders.hqUserId,
        schema.hqUserCommanders.commanderId,
      ],
      set: {
        isPrimary: input.setPrimary !== false,
        updatedAt: now,
      },
    });
}

/**
 * Mirror a roster member into commander tables.
 * Defers with name_conflict when orphan identity collides with another member.
 */
export async function syncCommanderFromAllianceMember(input: {
  allianceId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  joinedAt?: Date;
  leftAt?: Date | null;
}): Promise<CommanderSyncResult> {
  const memberRow = await loadAllianceMemberRow(
    input.allianceId,
    input.ashedMemberId,
  );
  if (!memberRow) {
    return { status: "deferred", reason: COMMANDER_SYNC_STATUS.PENDING };
  }

  const displayName =
    input.memberDisplayName ?? memberRow.currentName ?? null;
  const gameUid = await resolveGameUidForMember(
    input.allianceId,
    input.ashedMemberId,
    memberRow,
  );
  const gameServerNumber = await resolveAllianceGameServerNumber(
    input.allianceId,
  );

  if (gameUid) {
    const { commanderId } = await upsertCommanderFromLink({
      gameUid,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: displayName,
    });

    await upsertCommanderAllianceMembership({
      commanderId,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: displayName,
      joinedAt: input.joinedAt,
      leftAt: input.leftAt,
    });

    await setMemberCommanderSyncStatus(
      input.allianceId,
      input.ashedMemberId,
      COMMANDER_SYNC_STATUS.SYNCED,
    );
    return { status: "synced", commanderId };
  }

  const normalizedName = displayName
    ? normalizeCommanderName(displayName)
    : null;

  if (!normalizedName) {
    await setMemberCommanderSyncStatus(
      input.allianceId,
      input.ashedMemberId,
      COMMANDER_SYNC_STATUS.PENDING,
    );
    return { status: "deferred", reason: COMMANDER_SYNC_STATUS.PENDING };
  }

  if (gameServerNumber == null) {
    await setMemberCommanderSyncStatus(
      input.allianceId,
      input.ashedMemberId,
      COMMANDER_SYNC_STATUS.MISSING_SERVER,
    );
    return { status: "deferred", reason: COMMANDER_SYNC_STATUS.MISSING_SERVER };
  }

  const db = getDb();
  const [existingMembership] = await db
    .select({
      commanderId: schema.commanderAllianceMemberships.commanderId,
    })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          input.ashedMemberId,
        ),
      ),
    )
    .limit(1);

  const orphan = await findOrphanCommanderByNameServer({
    allianceId: input.allianceId,
    normalizedName,
    gameServerNumber,
  });

  if (orphan?.ashedMemberId && orphan.ashedMemberId !== input.ashedMemberId) {
    const conflict: CommanderIdentityConflict = {
      code: "name_taken_by_other_member",
      ashedMemberId: input.ashedMemberId,
      normalizedName,
      gameServerNumber,
      existingCommanderId: orphan.commander.id,
    };
    const reasonJson: CommanderConflictReasonJson = {
      code: conflict.code,
      normalizedName,
      gameServerNumber,
      existingCommanderId: orphan.commander.id,
    };
    await setMemberCommanderSyncStatus(
      input.allianceId,
      input.ashedMemberId,
      COMMANDER_SYNC_STATUS.NAME_CONFLICT,
      reasonJson,
    );
    return {
      status: "deferred",
      reason: COMMANDER_SYNC_STATUS.NAME_CONFLICT,
      conflict,
    };
  }

  if (!orphan) {
    const taken = await findNameTakenByOtherMember({
      allianceId: input.allianceId,
      normalizedName,
      gameServerNumber,
      excludeAshedMemberId: input.ashedMemberId,
    });
    if (taken) {
      const reasonJson: CommanderConflictReasonJson = {
        code: taken.code,
        normalizedName,
        gameServerNumber,
        existingCommanderId: taken.existingCommanderId,
        existingMemberName: taken.existingMemberName,
      };
      await setMemberCommanderSyncStatus(
        input.allianceId,
        input.ashedMemberId,
        COMMANDER_SYNC_STATUS.NAME_CONFLICT,
        reasonJson,
      );
      return {
        status: "deferred",
        reason: COMMANDER_SYNC_STATUS.NAME_CONFLICT,
        conflict: { ...taken, ashedMemberId: input.ashedMemberId },
      };
    }
  }

  const { commanderId } = await upsertCommanderRow({
    gameUid: null,
    gameServerNumber,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: displayName,
    existingCommanderId:
      orphan?.ashedMemberId === input.ashedMemberId ||
      orphan?.ashedMemberId == null
        ? orphan?.commander.id ?? existingMembership?.commanderId ?? null
        : existingMembership?.commanderId ?? null,
  });

  await upsertCommanderAllianceMembership({
    commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: displayName,
    joinedAt: input.joinedAt,
    leftAt: input.leftAt,
  });

  await setMemberCommanderSyncStatus(
    input.allianceId,
    input.ashedMemberId,
    COMMANDER_SYNC_STATUS.SYNCED,
  );
  return { status: "synced", commanderId };
}

/** Update roster display name and retry Commander sync (officer conflict resolution). */
export async function resolveMemberCommanderNameConflict(input: {
  allianceId: string;
  ashedMemberId: string;
  currentName: string;
}): Promise<CommanderSyncResult> {
  const trimmed = input.currentName.trim();
  if (!trimmed) {
    throw new Error("Member name is required.");
  }

  const db = getDb();
  const [memberRow] = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!memberRow) {
    throw new Error("Member not found.");
  }

  const previousNames = memberRow.previousNamesJson ?? [];
  const nameChanged = memberRow.currentName !== trimmed;
  const nextPreviousNames =
    nameChanged && !previousNames.includes(memberRow.currentName)
      ? [...previousNames, memberRow.currentName]
      : previousNames;

  await db
    .update(schema.allianceMembers)
    .set({
      currentName: trimmed,
      previousNamesJson: nextPreviousNames,
      updatedAt: new Date(),
    })
    .where(eq(schema.allianceMembers.id, memberRow.id));

  return syncCommanderFromAllianceMember({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: trimmed,
  });
}

/** Dual-write Commander identity after a successful web or Discord member link. */
export async function syncCommanderIdentityFromMemberLink(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUid: string;
  memberDisplayName?: string | null;
  hqUserId?: string;
  joinedAt?: Date;
}): Promise<void> {
  const { commanderId } = await upsertCommanderFromLink({
    gameUid: input.gameUid,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.memberDisplayName,
  });

  await upsertCommanderAllianceMembership({
    commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.memberDisplayName,
    joinedAt: input.joinedAt,
  });

  await setMemberCommanderSyncStatus(
    input.allianceId,
    input.ashedMemberId,
    COMMANDER_SYNC_STATUS.SYNCED,
  );

  if (input.hqUserId) {
    await linkHqUserToCommander({
      hqUserId: input.hqUserId,
      commanderId,
      linkedAt: input.joinedAt,
    });
  }
}

export async function countMembersWithCommanderSyncStatus(
  allianceId: string,
  status: CommanderSyncStatus,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.commanderSyncStatus, status),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Count members whose Commander sync is intentionally deferred but has no
 * actionable officer path in the current session:
 *   - missing_server: alliance game_server_number not yet linked; resolves when
 *     the owner completes name+UID member link (sets alliances.game_server_number)
 *     and roster is re-synced.
 *   - pending: member has a blank display name from Ashed; requires manual
 *     name correction via the conflict resolution sheet.
 *
 * These are distinct from name_conflict (surfaced via listCommanderIdentityConflictsForAlliance).
 */
export async function countDeferredCommanderSyncMembers(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        or(
          eq(
            schema.allianceMembers.commanderSyncStatus,
            COMMANDER_SYNC_STATUS.MISSING_SERVER,
          ),
          eq(
            schema.allianceMembers.commanderSyncStatus,
            COMMANDER_SYNC_STATUS.PENDING,
          ),
        ),
      ),
    );
  return row?.count ?? 0;
}
