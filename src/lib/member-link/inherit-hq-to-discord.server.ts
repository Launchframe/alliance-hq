import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export type InheritHqMemberLinksResult = {
  inherited: number;
  skipped: number;
};

/**
 * Remove Discord member links that mirror this HQ user's web commanders.
 * Used when an HQ account binds to a new Discord user so the old Discord
 * account does not keep inherited commander access.
 */
export async function revokeHqMirroredDiscordMemberLinks(input: {
  discordUserId: string;
  hqUserId: string;
}): Promise<void> {
  const discordUserId = input.discordUserId.trim();
  const hqUserId = input.hqUserId.trim();
  if (!discordUserId || !hqUserId) {
    return;
  }

  const {
    deleteDiscordMemberLink,
    getDiscordLinkByAllianceAndMember,
  } = await import("@/lib/vr/repository");

  const db = getDb();
  const hqLinks = await db
    .select({
      allianceId: schema.hqMemberLinks.allianceId,
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
    })
    .from(schema.hqMemberLinks)
    .where(eq(schema.hqMemberLinks.hqUserId, hqUserId));

  for (const hqLink of hqLinks) {
    const discordLink = await getDiscordLinkByAllianceAndMember(
      hqLink.allianceId,
      hqLink.ashedMemberId,
    );
    if (discordLink?.discordUserId === discordUserId) {
      await deleteDiscordMemberLink(discordLink.id);
    }
  }
}

/**
 * Copy HQ web commander links (`hq_member_links`) onto Discord
 * (`discord_member_links`) for the same person.
 *
 * Skips commanders already claimed by another Discord user and stops when the
 * per-user Discord link cap is reached. Idempotent for pairs that already exist.
 */
export async function inheritHqMemberLinksToDiscord(input: {
  discordUserId: string;
  hqUserId: string;
  allianceId?: string;
}): Promise<InheritHqMemberLinksResult> {
  const discordUserId = input.discordUserId.trim();
  const hqUserId = input.hqUserId.trim();
  if (!discordUserId || !hqUserId) {
    return { inherited: 0, skipped: 0 };
  }

  const { linkDiscordMember } = await import("@/lib/vr/repository");

  const db = getDb();
  const conditions = [eq(schema.hqMemberLinks.hqUserId, hqUserId)];
  if (input.allianceId) {
    conditions.push(eq(schema.hqMemberLinks.allianceId, input.allianceId));
  }

  const hqLinks = await db
    .select({
      allianceId: schema.hqMemberLinks.allianceId,
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      memberDisplayName: schema.hqMemberLinks.memberDisplayName,
      gameUid: schema.hqMemberLinks.gameUid,
    })
    .from(schema.hqMemberLinks)
    .where(and(...conditions));

  let inherited = 0;
  let skipped = 0;

  for (const link of hqLinks) {
    const result = await linkDiscordMember({
      allianceId: link.allianceId,
      discordUserId,
      ashedMemberId: link.ashedMemberId,
      memberDisplayName: link.memberDisplayName,
      gameUid: link.gameUid,
    });
    if (result.ok) {
      if (result.mode === "created" || result.mode === "replaced") {
        inherited += 1;
      }
      // "updated" already existed — not a new inherit.
      continue;
    }
    skipped += 1;
    if (result.reason === "cap_reached") {
      break;
    }
  }

  return { inherited, skipped };
}

/**
 * If this Discord user has an HQ account link, mirror any HQ commanders onto
 * Discord member links. Used after `/link` and lazily when bot commands need a
 * commander.
 */
export async function ensureDiscordMemberLinksFromHq(input: {
  discordUserId: string;
  allianceId?: string;
}): Promise<InheritHqMemberLinksResult> {
  const { getDiscordHqLink } = await import("@/lib/vr/repository");
  const hqLink = await getDiscordHqLink(input.discordUserId);
  if (!hqLink) {
    return { inherited: 0, skipped: 0 };
  }
  return inheritHqMemberLinksToDiscord({
    discordUserId: input.discordUserId,
    hqUserId: hqLink.hqUserId,
    allianceId: input.allianceId,
  });
}

/**
 * After a web commander link, mirror it to Discord when the HQ user already
 * has a Discord account link.
 */
export async function inheritHqMemberLinkToDiscordIfLinked(input: {
  hqUserId: string;
  allianceId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  gameUid: string;
}): Promise<boolean> {
  const { getDiscordHqLinkByHqUserId, linkDiscordMember } = await import(
    "@/lib/vr/repository"
  );
  const hqLink = await getDiscordHqLinkByHqUserId(input.hqUserId);
  if (!hqLink) {
    return false;
  }
  const result = await linkDiscordMember({
    allianceId: input.allianceId,
    discordUserId: hqLink.discordUserId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.memberDisplayName,
    gameUid: input.gameUid,
  });
  return result.ok;
}
