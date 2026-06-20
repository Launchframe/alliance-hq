import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { HqUser } from "@/lib/db/schema";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";

export const AVATAR_SOURCES = ["google", "discord", "lastwar"] as const;
export type AvatarSource = (typeof AVATAR_SOURCES)[number];

export type OAuthAvatarProvider = "google" | "discord";

export const LASTWAR_AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthProviderRow = {
  provider: string;
  avatarUrl: string | null;
};

export type ResolvedAvatar = {
  avatarUrl: string | null;
  avatarSource: AvatarSource | null;
};

/** Pure precedence: Google → Discord → Last War (for unit tests). */
export function pickAvatarFromProviders(
  providers: AuthProviderRow[],
  lastWarAvatarUrl?: string | null,
): ResolvedAvatar {
  const google = providers.find((row) => row.provider === "google");
  if (google?.avatarUrl) {
    return { avatarUrl: google.avatarUrl, avatarSource: "google" };
  }

  const discord = providers.find((row) => row.provider === "discord");
  if (discord?.avatarUrl) {
    return { avatarUrl: discord.avatarUrl, avatarSource: "discord" };
  }

  if (lastWarAvatarUrl) {
    return { avatarUrl: lastWarAvatarUrl, avatarSource: "lastwar" };
  }

  return { avatarUrl: null, avatarSource: null };
}

function isLastWarAvatarStale(user: Pick<HqUser, "avatarRefreshedAt">): boolean {
  if (!user.avatarRefreshedAt) {
    return true;
  }
  return Date.now() - user.avatarRefreshedAt.getTime() > LASTWAR_AVATAR_TTL_MS;
}

async function loadAuthProviders(hqUserId: string): Promise<AuthProviderRow[]> {
  const db = getDb();
  return db
    .select({
      provider: schema.hqUserAuthProviders.provider,
      avatarUrl: schema.hqUserAuthProviders.avatarUrl,
    })
    .from(schema.hqUserAuthProviders)
    .where(eq(schema.hqUserAuthProviders.hqUserId, hqUserId));
}

async function writeAvatarCache(
  hqUserId: string,
  resolved: ResolvedAvatar,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.hqUsers)
    .set({
      avatarUrl: resolved.avatarUrl,
      avatarSource: resolved.avatarSource,
      avatarRefreshedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.hqUsers.id, hqUserId));
}

/**
 * Resolve profile avatar with OAuth precedence, optional Last War lookup, and cache on hq_users.
 * Wire OAuth sign-in callbacks through syncOAuthProviderAvatar instead of calling this directly.
 */
export async function resolveAndCacheHqUserAvatar(
  hqUserId: string,
  options: {
    allianceId?: string | null;
    forceRefresh?: boolean;
  } = {},
): Promise<ResolvedAvatar> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  if (!user) {
    return { avatarUrl: null, avatarSource: null };
  }

  const providers = await loadAuthProviders(hqUserId);
  const oauthPick = pickAvatarFromProviders(providers);
  if (oauthPick.avatarUrl) {
    if (
      user.avatarUrl !== oauthPick.avatarUrl ||
      user.avatarSource !== oauthPick.avatarSource
    ) {
      await writeAvatarCache(hqUserId, oauthPick);
    }
    return oauthPick;
  }

  const uid = user.primaryGameUid?.trim();
  if (!uid) {
    if (user.avatarUrl || user.avatarSource) {
      await writeAvatarCache(hqUserId, {
        avatarUrl: null,
        avatarSource: null,
      });
    }
    return { avatarUrl: null, avatarSource: null };
  }

  const lastWarFresh =
    user.avatarSource === "lastwar" &&
    user.avatarUrl &&
    !isLastWarAvatarStale(user) &&
    !options.forceRefresh;

  if (lastWarFresh) {
    return { avatarUrl: user.avatarUrl, avatarSource: "lastwar" };
  }

  const lookup = await lookupPlayerByUid(uid);
  const lastWarResolved = pickAvatarFromProviders(providers, lookup.ok ? lookup.avatarUrl : null);
  await writeAvatarCache(hqUserId, lastWarResolved);
  return lastWarResolved;
}

async function syncPrimaryGameUidFromDiscordLink(
  hqUserId: string,
  discordUserId: string,
  allianceId: string,
): Promise<void> {
  const db = getDb();
  const [link] = await db
    .select({ gameUid: schema.discordMemberLinks.gameUid })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.discordUserId, discordUserId),
        eq(schema.discordMemberLinks.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!link?.gameUid?.trim()) {
    return;
  }

  await db
    .update(schema.hqUsers)
    .set({
      primaryGameUid: link.gameUid.trim(),
      updatedAt: new Date(),
    })
    .where(eq(schema.hqUsers.id, hqUserId));
}

/**
 * Upsert OAuth provider avatar and refresh cached hq_users.avatar_url.
 * Future: call from /api/auth/[provider]/callback after SSO lands.
 */
export async function syncOAuthProviderAvatar(
  hqUserId: string,
  provider: OAuthAvatarProvider,
  input: {
    providerUserId: string;
    avatarUrl?: string | null;
    allianceId?: string | null;
  },
): Promise<ResolvedAvatar> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select({ id: schema.hqUserAuthProviders.id })
    .from(schema.hqUserAuthProviders)
    .where(
      and(
        eq(schema.hqUserAuthProviders.hqUserId, hqUserId),
        eq(schema.hqUserAuthProviders.provider, provider),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.hqUserAuthProviders)
      .set({
        providerUserId: input.providerUserId,
        avatarUrl: input.avatarUrl ?? null,
        updatedAt: now,
      })
      .where(eq(schema.hqUserAuthProviders.id, existing.id));
  } else {
    await db.insert(schema.hqUserAuthProviders).values({
      id: nanoid(16),
      hqUserId,
      provider,
      providerUserId: input.providerUserId,
      avatarUrl: input.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (provider === "discord" && input.allianceId) {
    await syncPrimaryGameUidFromDiscordLink(
      hqUserId,
      input.providerUserId,
      input.allianceId,
    );
  }

  return resolveAndCacheHqUserAvatar(hqUserId, {
    allianceId: input.allianceId,
    forceRefresh: true,
  });
}

/** Refresh avatar when Last War cache is stale; OAuth URLs are always re-read from providers. */
export async function ensureHqUserAvatarFresh(
  user: HqUser,
  allianceId: string | null,
): Promise<string | null> {
  const providers = await loadAuthProviders(user.id);
  const oauthPick = pickAvatarFromProviders(providers);
  if (oauthPick.avatarUrl) {
    if (
      user.avatarUrl !== oauthPick.avatarUrl ||
      user.avatarSource !== oauthPick.avatarSource
    ) {
      await writeAvatarCache(user.id, oauthPick);
    }
    return oauthPick.avatarUrl;
  }

  const needsLastWarRefresh =
    user.primaryGameUid &&
    (user.avatarSource !== "lastwar" ||
      !user.avatarUrl ||
      isLastWarAvatarStale(user));

  if (!needsLastWarRefresh) {
    return user.avatarUrl;
  }

  const resolved = await resolveAndCacheHqUserAvatar(user.id, { allianceId });
  return resolved.avatarUrl;
}
