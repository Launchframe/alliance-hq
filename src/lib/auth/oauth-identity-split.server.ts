import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import type {
  OAuthIdentitySplitRow,
  OAuthIdentitySplitSummary,
} from "@/lib/auth/oauth-identity-split.shared";

export type { OAuthIdentitySplitRow, OAuthIdentitySplitSummary };

async function loadDiscordOAuthOwners(
  discordUserIds: string[],
): Promise<Map<string, string>> {
  if (discordUserIds.length === 0) {
    return new Map();
  }
  const db = getDb();
  const rows = await db
    .select({
      providerAccountId: schema.hqAuthAccounts.providerAccountId,
      hqUserId: schema.hqAuthAccounts.hqUserId,
    })
    .from(schema.hqAuthAccounts)
    .where(
      and(
        eq(schema.hqAuthAccounts.provider, "discord"),
        inArray(schema.hqAuthAccounts.providerAccountId, discordUserIds),
      ),
    );
  return new Map(rows.map((row) => [row.providerAccountId, row.hqUserId]));
}

async function loadHqUserEmails(
  hqUserIds: string[],
): Promise<Map<string, string>> {
  if (hqUserIds.length === 0) {
    return new Map();
  }
  const db = getDb();
  const rows = await db
    .select({ id: schema.hqUsers.id, email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(inArray(schema.hqUsers.id, hqUserIds));
  return new Map(rows.map((row) => [row.id, row.email]));
}

/**
 * Discord OAuth is bound to a different HQ user than the commander link expects
 * (discord_member_links + hq_member_links in the same alliance).
 */
export async function loadOAuthIdentitySplitsForAlliance(
  allianceId: string,
): Promise<Map<string, OAuthIdentitySplitRow>> {
  const db = getDb();
  const memberContexts = await db
    .select({
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      expectedHqUserId: schema.hqMemberLinks.hqUserId,
      allianceId: schema.hqMemberLinks.allianceId,
      allianceSlug: schema.alliances.slug,
      discordUserId: schema.discordMemberLinks.discordUserId,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinks.allianceId),
    )
    .innerJoin(
      schema.discordMemberLinks,
      and(
        eq(
          schema.discordMemberLinks.allianceId,
          schema.hqMemberLinks.allianceId,
        ),
        eq(
          schema.discordMemberLinks.ashedMemberId,
          schema.hqMemberLinks.ashedMemberId,
        ),
      ),
    )
    .where(eq(schema.hqMemberLinks.allianceId, allianceId));

  const splits = new Map<string, OAuthIdentitySplitRow>();
  if (memberContexts.length === 0) {
    return splits;
  }

  const discordUserIds = [
    ...new Set(memberContexts.map((row) => row.discordUserId)),
  ];
  const oauthOwnerByDiscord = await loadDiscordOAuthOwners(discordUserIds);

  const emailByUserId = await loadHqUserEmails([
    ...memberContexts.map((row) => row.expectedHqUserId),
    ...oauthOwnerByDiscord.values(),
  ]);

  for (const row of memberContexts) {
    const oauthHqUserId = oauthOwnerByDiscord.get(row.discordUserId);
    if (!oauthHqUserId || oauthHqUserId === row.expectedHqUserId) {
      continue;
    }
    splits.set(row.ashedMemberId, {
      provider: "discord",
      discordUserId: row.discordUserId,
      expectedHqUserId: row.expectedHqUserId,
      oauthHqUserId,
      oauthHqUserEmail: emailByUserId.get(oauthHqUserId) ?? "",
      ashedMemberId: row.ashedMemberId,
      allianceId: row.allianceId,
      allianceSlug: row.allianceSlug,
    });
  }

  return splits;
}

export async function loadOAuthIdentitySplitForHqUser(
  hqUserId: string,
): Promise<OAuthIdentitySplitSummary> {
  const db = getDb();
  const memberContexts = await db
    .select({
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      expectedHqUserId: schema.hqMemberLinks.hqUserId,
      allianceId: schema.hqMemberLinks.allianceId,
      allianceSlug: schema.alliances.slug,
      discordUserId: schema.discordMemberLinks.discordUserId,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinks.allianceId),
    )
    .innerJoin(
      schema.discordMemberLinks,
      and(
        eq(
          schema.discordMemberLinks.allianceId,
          schema.hqMemberLinks.allianceId,
        ),
        eq(
          schema.discordMemberLinks.ashedMemberId,
          schema.hqMemberLinks.ashedMemberId,
        ),
      ),
    )
    .where(eq(schema.hqMemberLinks.hqUserId, hqUserId));

  const splits: OAuthIdentitySplitRow[] = [];

  const discordUserIds = [
    ...new Set(memberContexts.map((row) => row.discordUserId)),
  ];
  const oauthOwnerByDiscord = await loadDiscordOAuthOwners(discordUserIds);
  const oauthOwnerIds = new Set(oauthOwnerByDiscord.values());

  for (const row of memberContexts) {
    const oauthHqUserId = oauthOwnerByDiscord.get(row.discordUserId);
    if (!oauthHqUserId || oauthHqUserId === row.expectedHqUserId) {
      continue;
    }
    splits.push({
      provider: "discord",
      discordUserId: row.discordUserId,
      expectedHqUserId: row.expectedHqUserId,
      oauthHqUserId,
      oauthHqUserEmail: "",
      ashedMemberId: row.ashedMemberId,
      allianceId: row.allianceId,
      allianceSlug: row.allianceSlug,
    });
  }

  if (splits.length === 0) {
    return { hasSplit: false, splits: [] };
  }

  const emailByUserId = await loadHqUserEmails([
    hqUserId,
    ...oauthOwnerIds,
  ]);
  for (const split of splits) {
    split.oauthHqUserEmail = emailByUserId.get(split.oauthHqUserId) ?? "";
  }

  return { hasSplit: true, splits };
}

export async function hqUserIdsWithOAuthIdentitySplit(
  hqUserIds: string[],
): Promise<Set<string>> {
  if (hqUserIds.length === 0) {
    return new Set();
  }

  const db = getDb();
  const memberContexts = await db
    .select({
      expectedHqUserId: schema.hqMemberLinks.hqUserId,
      discordUserId: schema.discordMemberLinks.discordUserId,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.discordMemberLinks,
      and(
        eq(
          schema.discordMemberLinks.allianceId,
          schema.hqMemberLinks.allianceId,
        ),
        eq(
          schema.discordMemberLinks.ashedMemberId,
          schema.hqMemberLinks.ashedMemberId,
        ),
      ),
    )
    .where(inArray(schema.hqMemberLinks.hqUserId, hqUserIds));

  const oauthOwnerByDiscord = await loadDiscordOAuthOwners([
    ...new Set(memberContexts.map((row) => row.discordUserId)),
  ]);

  const flagged = new Set<string>();
  for (const row of memberContexts) {
    const oauthHqUserId = oauthOwnerByDiscord.get(row.discordUserId);
    if (oauthHqUserId && oauthHqUserId !== row.expectedHqUserId) {
      flagged.add(row.expectedHqUserId);
    }
  }
  return flagged;
}
