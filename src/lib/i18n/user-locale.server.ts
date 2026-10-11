import "server-only";

import { desc, eq, inArray, isNotNull, and } from "drizzle-orm";

import type { AppLocale } from "@/i18n/routing";
import { getDb, schema } from "@/lib/db";

import { resolveUserLocale, type UserLocaleResolution } from "./user-locale.shared";

export type UserLocaleState = UserLocaleResolution & {
  manual: AppLocale | null;
  /** Locale LastRank would pick when no manual choice exists. */
  automatic: UserLocaleResolution;
};

async function loadLastRankCountries(hqUserIds: string[]) {
  if (hqUserIds.length === 0) return new Map<string, string[]>();
  const rows = await getDb()
    .select({
      hqUserId: schema.hqUserCommanders.hqUserId,
      country: schema.commanders.lastrankCountry,
    })
    .from(schema.hqUserCommanders)
    .innerJoin(schema.commanders, eq(schema.commanders.id, schema.hqUserCommanders.commanderId))
    .where(
      and(
        inArray(schema.hqUserCommanders.hqUserId, hqUserIds),
        isNotNull(schema.commanders.lastrankCountry),
      ),
    )
    .orderBy(desc(schema.hqUserCommanders.isPrimary), desc(schema.hqUserCommanders.linkedAt));
  const byUser = new Map<string, string[]>();
  for (const row of rows) {
    const list = byUser.get(row.hqUserId) ?? [];
    list.push(row.country!);
    byUser.set(row.hqUserId, list);
  }
  return byUser;
}

export async function loadUserLocaleStates(
  hqUserIds: string[],
): Promise<Map<string, UserLocaleState>> {
  const ids = [...new Set(hqUserIds.filter(Boolean))];
  const result = new Map<string, UserLocaleState>();
  if (ids.length === 0) return result;
  const [users, countries] = await Promise.all([
    getDb()
      .select({ id: schema.hqUsers.id, preferredLocale: schema.hqUsers.preferredLocale })
      .from(schema.hqUsers)
      .where(inArray(schema.hqUsers.id, ids)),
    loadLastRankCountries(ids),
  ]);
  for (const user of users) {
    const lastrankCountries = countries.get(user.id) ?? [];
    const automatic = resolveUserLocale({ manual: null, lastrankCountries });
    const resolved = resolveUserLocale({ manual: user.preferredLocale, lastrankCountries });
    result.set(user.id, {
      ...resolved,
      manual: resolved.source === "manual" ? resolved.locale : null,
      automatic,
    });
  }
  return result;
}

export async function loadUserLocaleState(hqUserId: string): Promise<UserLocaleState> {
  return (
    (await loadUserLocaleStates([hqUserId])).get(hqUserId) ?? {
      locale: "en-US",
      source: "default",
      manual: null,
      automatic: { locale: "en-US", source: "default" },
    }
  );
}

/** Locale for emails and notifications sent to this HQ user. */
export async function resolveNotificationLocale(
  hqUserId: string | null | undefined,
): Promise<AppLocale> {
  if (!hqUserId) return "en-US";
  return (await loadUserLocaleState(hqUserId)).locale;
}

/**
 * Save a manual pick (`null` = back to automatic). A manual pick also updates
 * the linked Discord user's /language so bot replies match.
 */
export async function setManualPreferredLocale(
  hqUserId: string,
  locale: AppLocale | null,
  options: { syncDiscord?: boolean } = {},
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.hqUsers)
    .set({ preferredLocale: locale, updatedAt: now })
    .where(eq(schema.hqUsers.id, hqUserId));

  if (!locale || options.syncDiscord === false) return;
  const links = await db
    .select({ discordUserId: schema.discordHqLinks.discordUserId })
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.hqUserId, hqUserId));
  for (const link of links) {
    await db
      .insert(schema.discordUserPrefs)
      .values({ discordUserId: link.discordUserId, locale, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.discordUserPrefs.discordUserId,
        set: { locale, updatedAt: now },
      });
  }
}
