import "server-only";

/**
 * Commander identity — UID-keyed stats, alliance memberships, and HQ ownership.
 *
 * Writes mirror roster sync, rank updates, and tenure open/close into commander tables.
 * Read paths prefer commander rows when a linked UID exists, with `alliance_members`
 * as fallback for unlinked roster-only members.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type {
  Commander,
  CommanderAllianceMembership,
} from "@/lib/db/schema";

type AllianceMemberRow = typeof schema.allianceMembers.$inferSelect;

function normalizeGameUid(gameUid: string): string | null {
  const trimmed = gameUid.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function commanderStatsFromMemberRow(
  memberRow: AllianceMemberRow | null | undefined,
  fallbackName?: string | null,
) {
  return {
    primaryName: memberRow?.currentName ?? fallbackName ?? null,
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
    .orderBy(desc(schema.commanderAllianceMemberships.joinedAt));
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

  const db = getDb();
  const now = new Date();
  const memberRow = await loadAllianceMemberRow(
    input.allianceId,
    input.ashedMemberId,
  );
  const stats = commanderStatsFromMemberRow(memberRow, input.memberDisplayName);

  const existing = await resolveCommanderByUid(normalized);
  if (existing) {
    await db
      .update(schema.commanders)
      .set({
        ...stats,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, existing.id));
    return { commanderId: existing.id };
  }

  const [row] = await db
    .insert(schema.commanders)
    .values({
      id: nanoid(),
      gameUid: normalized,
      ...stats,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.commanders.id });

  return { commanderId: row!.id };
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
 * Mirror a roster member row into commander tables when a UID is known.
 * No-op when the member has no linked UID (roster-only / unclaimed).
 */
export async function syncCommanderFromAllianceMember(input: {
  allianceId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  joinedAt?: Date;
  leftAt?: Date | null;
}): Promise<void> {
  const memberRow = await loadAllianceMemberRow(
    input.allianceId,
    input.ashedMemberId,
  );
  const gameUid = await resolveGameUidForMember(
    input.allianceId,
    input.ashedMemberId,
    memberRow,
  );
  if (!gameUid) return;

  const { commanderId } = await upsertCommanderFromLink({
    gameUid,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName:
      input.memberDisplayName ?? memberRow?.currentName ?? null,
  });

  await upsertCommanderAllianceMembership({
    commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName:
      input.memberDisplayName ?? memberRow?.currentName ?? null,
    joinedAt: input.joinedAt,
    leftAt: input.leftAt,
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

  if (input.hqUserId) {
    await linkHqUserToCommander({
      hqUserId: input.hqUserId,
      commanderId,
      linkedAt: input.joinedAt,
    });
  }
}
