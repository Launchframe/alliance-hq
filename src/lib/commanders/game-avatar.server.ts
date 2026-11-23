import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { isValidGameUid } from "@/lib/lastwar/player-lookup";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup.server";
import { isCommanderGameAvatarStale } from "@/lib/commanders/game-avatar.shared";
import { LASTWAR_AVATAR_TTL_MS } from "@/lib/profile/avatar-ttl.shared";

export { isCommanderGameAvatarStale } from "@/lib/commanders/game-avatar.shared";

/** Persist a known Last War portrait onto the commander row (no network). */
export async function writeCommanderGameAvatar(input: {
  commanderId: string;
  avatarUrl: string | null | undefined;
  /** When false, keep the prior URL if the lookup returned no portrait. */
  clearMissing?: boolean;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  const nextUrl = input.avatarUrl?.trim() || null;

  if (nextUrl) {
    await db
      .update(schema.commanders)
      .set({
        gameAvatarUrl: nextUrl,
        gameAvatarRefreshedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, input.commanderId));
    return;
  }

  if (input.clearMissing) {
    await db
      .update(schema.commanders)
      .set({
        gameAvatarUrl: null,
        gameAvatarRefreshedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, input.commanderId));
    return;
  }

  // Failed / empty portrait: bump refreshed_at only so TTL backs off.
  await db
    .update(schema.commanders)
    .set({
      gameAvatarRefreshedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, input.commanderId));
}

/**
 * One Last War UID lookup for a commander when the cached portrait is stale.
 * Fail-soft: never throws; bumps refreshed_at on failure.
 */
export async function refreshCommanderGameAvatarIfStale(input: {
  commanderId: string;
  gameUid: string | null | undefined;
  gameAvatarUrl?: string | null;
  gameAvatarRefreshedAt?: Date | null;
  force?: boolean;
}): Promise<string | null> {
  const uid = input.gameUid?.trim() ?? "";
  if (!uid || !isValidGameUid(uid)) return input.gameAvatarUrl ?? null;

  if (!input.force && !isCommanderGameAvatarStale(input.gameAvatarRefreshedAt)) {
    return input.gameAvatarUrl ?? null;
  }

  try {
    const lookup = await lookupPlayerByUid(uid);
    if (lookup.ok) {
      await writeCommanderGameAvatar({
        commanderId: input.commanderId,
        avatarUrl: lookup.avatarUrl ?? null,
        clearMissing: !lookup.avatarUrl,
      });
      return lookup.avatarUrl?.trim() || null;
    }
    await writeCommanderGameAvatar({
      commanderId: input.commanderId,
      avatarUrl: null,
    });
    return input.gameAvatarUrl ?? null;
  } catch (error) {
    console.error("[commander-avatar] refresh failed", {
      commanderId: input.commanderId,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await writeCommanderGameAvatar({
        commanderId: input.commanderId,
        avatarUrl: null,
      });
    } catch {
      // ignore secondary write failure
    }
    return input.gameAvatarUrl ?? null;
  }
}

const MEMBERS_PAGE_AVATAR_REFRESH_LIMIT = 8;

/**
 * Best-effort: refresh a few missing/stale linked commanders so the members
 * table fills in over repeat visits without one lookup per roster row.
 */
export async function refreshStaleAllianceCommanderAvatars(
  allianceId: string,
  limit = MEMBERS_PAGE_AVATAR_REFRESH_LIMIT,
): Promise<void> {
  const db = getDb();
  const staleBefore = new Date(Date.now() - LASTWAR_AVATAR_TTL_MS);

  const rows = await db
    .select({
      commanderId: schema.commanders.id,
      gameUid: schema.commanders.gameUid,
      gameAvatarUrl: schema.commanders.gameAvatarUrl,
      gameAvatarRefreshedAt: schema.commanders.gameAvatarRefreshedAt,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
        sql`${schema.commanders.gameUid} is not null`,
        or(
          isNull(schema.commanders.gameAvatarRefreshedAt),
          lt(schema.commanders.gameAvatarRefreshedAt, staleBefore),
        ),
      ),
    )
    .orderBy(
      sql`${schema.commanders.gameAvatarUrl} nulls first`,
      sql`${schema.commanders.gameAvatarRefreshedAt} nulls first`,
    )
    .limit(limit);

  await Promise.all(
    rows.map((row) =>
      refreshCommanderGameAvatarIfStale({
        commanderId: row.commanderId,
        gameUid: row.gameUid,
        gameAvatarUrl: row.gameAvatarUrl,
        gameAvatarRefreshedAt: row.gameAvatarRefreshedAt,
        force: true,
      }),
    ),
  );
}
