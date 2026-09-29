import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { denormalizeGameUidOnMember } from "@/lib/members/member-tenure.server";
import { findExactMemberByName } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";

type DiscordMemberLinkRow = typeof schema.discordMemberLinks.$inferSelect;

async function loadRosterMember(
  allianceId: string,
  ashedMemberId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      status: schema.allianceMembers.status,
      gameUid: schema.allianceMembers.gameUid,
    })
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

async function findActiveMemberByGameUid(
  allianceId: string,
  gameUid: string,
) {
  const db = getDb();
  const [row] = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.gameUid, gameUid),
        eq(schema.allianceMembers.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function discordSeatOccupiedByOther(input: {
  allianceId: string;
  ashedMemberId: string;
  discordUserId: string;
}): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ discordUserId: schema.discordMemberLinks.discordUserId })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, input.allianceId),
        eq(schema.discordMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);
  return Boolean(row && row.discordUserId !== input.discordUserId);
}

/** Same-UID HQ claim on the live seat is ours; a different UID is another HQ user. */
async function hqSeatOccupiedByOther(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUid: string;
}): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ gameUid: schema.hqMemberLinks.gameUid })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);
  if (!row) return false;
  return row.gameUid.trim() !== input.gameUid.trim();
}

async function liveSeatOccupiedByOther(input: {
  allianceId: string;
  ashedMemberId: string;
  discordUserId: string;
  gameUid: string;
}): Promise<boolean> {
  if (
    await discordSeatOccupiedByOther({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      discordUserId: input.discordUserId,
    })
  ) {
    return true;
  }
  return hqSeatOccupiedByOther({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid: input.gameUid,
  });
}

type SeatHandoffDb = {
  update: ReturnType<typeof getDb>["update"];
};

async function retargetHqMemberLinkForSeatHandoff(
  db: SeatHandoffDb,
  input: {
    allianceId: string;
    gameUid: string;
    previousAshedMemberId: string;
    ashedMemberId: string;
    currentName: string;
    now: Date;
  },
): Promise<string | null> {
  const trimmed = input.gameUid.trim();
  if (!trimmed) return null;

  const [updated] = await db
    .update(schema.hqMemberLinks)
    .set({
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: input.currentName,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.gameUid, trimmed),
        eq(schema.hqMemberLinks.ashedMemberId, input.previousAshedMemberId),
      ),
    )
    .returning({ hqUserId: schema.hqMemberLinks.hqUserId });

  return updated?.hqUserId ?? null;
}

async function rebindDiscordLinkSeat(input: {
  link: DiscordMemberLinkRow;
  ashedMemberId: string;
  currentName: string;
}): Promise<DiscordMemberLinkRow> {
  const now = new Date();
  const previousAshedMemberId = input.link.ashedMemberId;
  const db = getDb();

  const { next, hqUserId } = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.discordMemberLinks)
      .set({
        ashedMemberId: input.ashedMemberId,
        memberDisplayName: input.currentName,
        updatedAt: now,
      })
      .where(eq(schema.discordMemberLinks.id, input.link.id))
      .returning();

    const nextRow = updated ?? {
      ...input.link,
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: input.currentName,
      updatedAt: now,
    };

    const hqUserId = await retargetHqMemberLinkForSeatHandoff(tx, {
      allianceId: nextRow.allianceId,
      gameUid: nextRow.gameUid,
      previousAshedMemberId,
      ashedMemberId: nextRow.ashedMemberId,
      currentName: input.currentName,
      now,
    });

    return { next: nextRow, hqUserId };
  });

  await denormalizeGameUidOnMember({
    allianceId: next.allianceId,
    ashedMemberId: next.ashedMemberId,
    gameUid: next.gameUid,
  });

  const { syncCommanderIdentityFromMemberLink } = await import(
    "@/lib/members/commander-identity.server"
  );
  await syncCommanderIdentityFromMemberLink({
    allianceId: next.allianceId,
    ashedMemberId: next.ashedMemberId,
    gameUid: next.gameUid,
    memberDisplayName: input.currentName,
    hqUserId: hqUserId ?? undefined,
  });

  return next;
}

async function resolveLiveSeatForFormerLink(
  link: DiscordMemberLinkRow,
): Promise<{ ashedMemberId: string; currentName: string } | null> {
  const gameUid = link.gameUid.trim();
  if (!gameUid) return null;

  const occupancy = {
    allianceId: link.allianceId,
    discordUserId: link.discordUserId,
    gameUid,
  };

  const byUid = await findActiveMemberByGameUid(link.allianceId, gameUid);
  if (byUid && byUid.ashedMemberId !== link.ashedMemberId) {
    if (
      await liveSeatOccupiedByOther({
        ...occupancy,
        ashedMemberId: byUid.ashedMemberId,
      })
    ) {
      return null;
    }
    return { ashedMemberId: byUid.ashedMemberId, currentName: byUid.currentName };
  }

  const lookup = await lookupPlayerByUid(gameUid);
  if (!lookup.ok) return null;

  const members = await loadAllianceMembersForBot(link.allianceId);
  const match = findExactMemberByName(members, lookup.gameUserName);
  if (!match || match.id === link.ashedMemberId) return null;
  if (
    await liveSeatOccupiedByOther({
      ...occupancy,
      ashedMemberId: match.id,
    })
  ) {
    return null;
  }
  return { ashedMemberId: match.id, currentName: match.current_name };
}

export async function overlayDiscordMemberLinkName(
  link: DiscordMemberLinkRow,
): Promise<DiscordMemberLinkRow> {
  const member = await loadRosterMember(link.allianceId, link.ashedMemberId);
  if (!member?.currentName) return link;
  return { ...link, memberDisplayName: member.currentName };
}

/**
 * Discord replies use HQ's current roster name, never the frozen link snapshot.
 * If the linked Ashed seat is `former`, follow the stored Last War UID onto the
 * live roster row (rename / account hand-off) and retarget commander identity.
 */
export async function hydrateDiscordMemberLink(
  link: DiscordMemberLinkRow,
  options?: { rematerializeFormer?: boolean },
): Promise<DiscordMemberLinkRow> {
  const member = await loadRosterMember(link.allianceId, link.ashedMemberId);
  let next = member?.currentName
    ? { ...link, memberDisplayName: member.currentName }
    : link;

  if (member?.status === "active" || options?.rematerializeFormer === false) {
    return next;
  }

  try {
    const live = await resolveLiveSeatForFormerLink(link);
    if (!live) return next;
    next = await rebindDiscordLinkSeat({
      link: next,
      ashedMemberId: live.ashedMemberId,
      currentName: live.currentName,
    });
    return { ...next, memberDisplayName: live.currentName };
  } catch {
    console.error("[discord-bot] live roster follow failed", {
      linkId: link.id,
      allianceId: link.allianceId,
    });
    return next;
  }
}

export async function hydrateDiscordMemberLinks(
  links: DiscordMemberLinkRow[],
  options?: { rematerializeFormer?: boolean },
): Promise<DiscordMemberLinkRow[]> {
  return Promise.all(
    links.map((link) => hydrateDiscordMemberLink(link, options)),
  );
}
