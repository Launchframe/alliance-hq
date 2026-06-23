import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

async function resolveGameUidForMember(
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
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

export async function denormalizeGameUidOnMember(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUid: string;
}): Promise<void> {
  const trimmed = input.gameUid.trim();
  if (!trimmed) return;

  const db = getDb();
  await db
    .update(schema.allianceMembers)
    .set({ gameUid: trimmed, updatedAt: new Date() })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    );
}

export async function openMemberAllianceTenure(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUid?: string | null;
  joinedAt?: Date;
}): Promise<void> {
  const gameUid =
    input.gameUid?.trim() ??
    (await resolveGameUidForMember(input.allianceId, input.ashedMemberId));
  if (!gameUid) return;

  const db = getDb();
  const now = input.joinedAt ?? new Date();

  const [active] = await db
    .select({ id: schema.memberAllianceTenure.id })
    .from(schema.memberAllianceTenure)
    .where(
      and(
        eq(schema.memberAllianceTenure.allianceId, input.allianceId),
        eq(schema.memberAllianceTenure.ashedMemberId, input.ashedMemberId),
        isNull(schema.memberAllianceTenure.leftAt),
      ),
    )
    .limit(1);

  if (active) {
    await db
      .update(schema.memberAllianceTenure)
      .set({ gameUid, updatedAt: now })
      .where(eq(schema.memberAllianceTenure.id, active.id));
    await denormalizeGameUidOnMember({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      gameUid,
    });
    return;
  }

  await db.insert(schema.memberAllianceTenure).values({
    id: nanoid(),
    gameUid,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    joinedAt: now,
    updatedAt: now,
  });

  await denormalizeGameUidOnMember({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid,
  });
}

export async function closeMemberAllianceTenure(input: {
  allianceId: string;
  ashedMemberId: string;
  leftAt?: Date;
}): Promise<void> {
  const db = getDb();
  const now = input.leftAt ?? new Date();

  await db
    .update(schema.memberAllianceTenure)
    .set({ leftAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.memberAllianceTenure.allianceId, input.allianceId),
        eq(schema.memberAllianceTenure.ashedMemberId, input.ashedMemberId),
        isNull(schema.memberAllianceTenure.leftAt),
      ),
    );
}

export async function syncTenureFromMemberStatus(input: {
  allianceId: string;
  ashedMemberId: string;
  status: string;
  gameUid?: string | null;
}): Promise<void> {
  if (input.status === "former") {
    await closeMemberAllianceTenure({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
    });
    return;
  }

  await openMemberAllianceTenure({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid: input.gameUid,
  });
}

export async function listTenureHistoryByGameUid(gameUid: string) {
  const db = getDb();
  return db
    .select({
      id: schema.memberAllianceTenure.id,
      gameUid: schema.memberAllianceTenure.gameUid,
      allianceId: schema.memberAllianceTenure.allianceId,
      ashedMemberId: schema.memberAllianceTenure.ashedMemberId,
      joinedAt: schema.memberAllianceTenure.joinedAt,
      leftAt: schema.memberAllianceTenure.leftAt,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
    })
    .from(schema.memberAllianceTenure)
    .innerJoin(
      schema.alliances,
      eq(schema.memberAllianceTenure.allianceId, schema.alliances.id),
    )
    .where(eq(schema.memberAllianceTenure.gameUid, gameUid))
    .orderBy(desc(schema.memberAllianceTenure.joinedAt));
}
