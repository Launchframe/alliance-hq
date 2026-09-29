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

async function rebindDiscordLinkSeat(input: {
  link: DiscordMemberLinkRow;
  ashedMemberId: string;
  currentName: string;
}): Promise<DiscordMemberLinkRow> {
  const now = new Date();
  const db = getDb();
  const [updated] = await db
    .update(schema.discordMemberLinks)
    .set({
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: input.currentName,
      updatedAt: now,
    })
    .where(eq(schema.discordMemberLinks.id, input.link.id))
    .returning();

  const next = updated ?? {
    ...input.link,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.currentName,
    updatedAt: now,
  };

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
  });

  return next;
}

async function resolveLiveSeatForFormerLink(
  link: DiscordMemberLinkRow,
): Promise<{ ashedMemberId: string; currentName: string } | null> {
  const gameUid = link.gameUid.trim();
  if (!gameUid) return null;

  const byUid = await findActiveMemberByGameUid(link.allianceId, gameUid);
  if (byUid && byUid.ashedMemberId !== link.ashedMemberId) {
    if (
      await discordSeatOccupiedByOther({
        allianceId: link.allianceId,
        ashedMemberId: byUid.ashedMemberId,
        discordUserId: link.discordUserId,
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
    await discordSeatOccupiedByOther({
      allianceId: link.allianceId,
      ashedMemberId: match.id,
      discordUserId: link.discordUserId,
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
  } catch (error) {
    console.error("[discord-bot] live roster follow failed", error);
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
