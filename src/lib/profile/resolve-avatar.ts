import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  refreshCommanderGameAvatarIfStale,
} from "@/lib/commanders/game-avatar.server";
import { getDb, schema } from "@/lib/db";
import type { HqUser } from "@/lib/db/schema";
import { LASTWAR_AVATAR_TTL_MS } from "@/lib/profile/avatar-ttl.shared";

export { LASTWAR_AVATAR_TTL_MS } from "@/lib/profile/avatar-ttl.shared";

export const AVATAR_SOURCES = ["google", "discord", "lastwar"] as const;
export type AvatarSource = (typeof AVATAR_SOURCES)[number];

export type OAuthAvatarProvider = "google" | "discord";

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

/** True when never refreshed or past TTL. */
export function isLastWarAvatarStale(
  user: Pick<HqUser, "avatarRefreshedAt">,
): boolean {
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
 * Portrait for the commander linked to this HQ user in the selected alliance.
 * One HQ link per alliance → one portrait per alliance.
 */
async function loadLinkedCommanderAvatarForAlliance(
  hqUserId: string,
  allianceId: string,
): Promise<{
  commanderId: string;
  gameUid: string | null;
  gameAvatarUrl: string | null;
  gameAvatarRefreshedAt: Date | null;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      commanderId: schema.commanders.id,
      gameUid: schema.commanders.gameUid,
      gameAvatarUrl: schema.commanders.gameAvatarUrl,
      gameAvatarRefreshedAt: schema.commanders.gameAvatarRefreshedAt,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.commanderAllianceMemberships,
      and(
        eq(
          schema.commanderAllianceMemberships.allianceId,
          schema.hqMemberLinks.allianceId,
        ),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          schema.hqMemberLinks.ashedMemberId,
        ),
      ),
    )
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
        eq(schema.hqMemberLinks.allianceId, allianceId),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function resolveLastWarAvatarForAlliance(
  hqUserId: string,
  allianceId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ResolvedAvatar> {
  const linked = await loadLinkedCommanderAvatarForAlliance(hqUserId, allianceId);
  if (!linked) {
    return { avatarUrl: null, avatarSource: null };
  }

  const url = await refreshCommanderGameAvatarIfStale({
    commanderId: linked.commanderId,
    gameUid: linked.gameUid,
    gameAvatarUrl: linked.gameAvatarUrl,
    gameAvatarRefreshedAt: linked.gameAvatarRefreshedAt,
    force: options.forceRefresh,
  });

  if (!url) {
    return { avatarUrl: null, avatarSource: "lastwar" };
  }
  return { avatarUrl: url, avatarSource: "lastwar" };
}

/**
 * Resolve profile avatar with OAuth precedence, optional Last War lookup, and cache on hq_users.
 * Last War fallback uses the commander linked in `allianceId` (alliance picker).
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

  const allianceId = options.allianceId?.trim() || null;
  if (!allianceId) {
    if (user.avatarUrl || user.avatarSource) {
      await writeAvatarCache(hqUserId, {
        avatarUrl: null,
        avatarSource: null,
      });
    }
    return { avatarUrl: null, avatarSource: null };
  }

  const lastWar = await resolveLastWarAvatarForAlliance(
    hqUserId,
    allianceId,
    options,
  );
  if (
    user.avatarUrl !== lastWar.avatarUrl ||
    user.avatarSource !== lastWar.avatarSource
  ) {
    await writeAvatarCache(hqUserId, lastWar);
  } else if (options.forceRefresh || isLastWarAvatarStale(user)) {
    await writeAvatarCache(hqUserId, lastWar);
  }
  return lastWar;
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

  return resolveAndCacheHqUserAvatar(hqUserId, {
    allianceId: input.allianceId,
    forceRefresh: true,
  });
}

/**
 * Refresh avatar when Last War cache is stale; OAuth URLs are always re-read from providers.
 * Last War fallback follows the commander linked in the selected alliance.
 * Fail-soft: never throw — callers (page bootstrap) must not 500 when Last War is down.
 */
export async function ensureHqUserAvatarFresh(
  user: HqUser,
  allianceId: string | null,
): Promise<string | null> {
  try {
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

    // Always re-read the selected alliance's commander portrait so switching
    // alliances updates the shell even when the hq_users cache TTL is fresh.
    const resolved = await resolveAndCacheHqUserAvatar(user.id, { allianceId });
    return resolved.avatarUrl;
  } catch (error) {
    console.error("[avatar] ensureHqUserAvatarFresh failed:", error);
    return user.avatarUrl;
  }
}
