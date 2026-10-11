import "server-only";

import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { destinationById } from "@/lib/nav/registry";
import type { NavigationPreferences } from "@/lib/nav/preferences.shared";

export async function loadNavigationPreferences(
  hqUserId: string | null | undefined,
): Promise<NavigationPreferences> {
  if (!hqUserId) {
    return { showAshedPages: true, favorites: [], recents: [] };
  }

  const db = getDb();

  const [prefs] = await db
    .select({ showAshedPages: schema.navigationPreferences.showAshedPages })
    .from(schema.navigationPreferences)
    .where(eq(schema.navigationPreferences.hqUserId, hqUserId))
    .limit(1);

  const favoriteRows = await db
    .select({ destinationId: schema.navigationFavorites.destinationId })
    .from(schema.navigationFavorites)
    .where(eq(schema.navigationFavorites.hqUserId, hqUserId))
    .orderBy(
      asc(schema.navigationFavorites.createdAt),
      asc(schema.navigationFavorites.destinationId),
    );

  const recentRows = await db
    .select({ destinationId: schema.navigationRecents.destinationId })
    .from(schema.navigationRecents)
    .where(eq(schema.navigationRecents.hqUserId, hqUserId))
    .orderBy(desc(schema.navigationRecents.lastVisitedAt))
    .limit(25);

  return {
    showAshedPages: prefs?.showAshedPages ?? true,
    favorites: favoriteRows.map((r) => r.destinationId),
    recents: recentRows.map((r) => r.destinationId),
  };
}

export async function setShowAshedPages(
  hqUserId: string,
  value: boolean,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.navigationPreferences)
    .values({ hqUserId, showAshedPages: value, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.navigationPreferences.hqUserId,
      set: { showAshedPages: value, updatedAt: now },
    });
}

export function isFavoriteableDestination(destinationId: string): boolean {
  return destinationById(destinationId)?.favoriteable === true;
}

export async function toggleNavigationFavorite(
  hqUserId: string,
  destinationId: string,
): Promise<{ isFavorite: boolean }> {
  if (!isFavoriteableDestination(destinationId)) {
    throw new Error("Invalid navigation destination");
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`nav-favorites:${hqUserId}`}, 0))`,
    );

    const [existing] = await tx
      .select({ destinationId: schema.navigationFavorites.destinationId })
      .from(schema.navigationFavorites)
      .where(
        and(
          eq(schema.navigationFavorites.hqUserId, hqUserId),
          eq(schema.navigationFavorites.destinationId, destinationId),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .delete(schema.navigationFavorites)
        .where(
          and(
            eq(schema.navigationFavorites.hqUserId, hqUserId),
            eq(schema.navigationFavorites.destinationId, destinationId),
          ),
        );
      return { isFavorite: false };
    }

    await tx.insert(schema.navigationFavorites).values({
      hqUserId,
      destinationId,
      createdAt: new Date(),
    });
    return { isFavorite: true };
  });
}

export async function recordNavigationVisit(
  hqUserId: string,
  destinationId: string,
): Promise<void> {
  if (!isFavoriteableDestination(destinationId)) {
    return;
  }

  const db = getDb();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`nav-recents:${hqUserId}`}, 0))`,
    );

    await tx
      .insert(schema.navigationRecents)
      .values({ hqUserId, destinationId, lastVisitedAt: now })
      .onConflictDoUpdate({
        target: [
          schema.navigationRecents.hqUserId,
          schema.navigationRecents.destinationId,
        ],
        set: { lastVisitedAt: now },
      });

    const toKeep = await tx
      .select({ destinationId: schema.navigationRecents.destinationId })
      .from(schema.navigationRecents)
      .where(eq(schema.navigationRecents.hqUserId, hqUserId))
      .orderBy(desc(schema.navigationRecents.lastVisitedAt))
      .limit(25);

    const keepIds = toKeep.map((r) => r.destinationId);
    await tx
      .delete(schema.navigationRecents)
      .where(
        and(
          eq(schema.navigationRecents.hqUserId, hqUserId),
          keepIds.length > 0
            ? notInArray(schema.navigationRecents.destinationId, keepIds)
            : sql`false`,
        ),
      );
  });
}
