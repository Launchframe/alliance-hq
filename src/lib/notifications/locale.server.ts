import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";

import enUS from "../../../messages/en-US.json";
import idMessages from "../../../messages/id.json";
import ptBR from "../../../messages/pt-BR.json";

import type { AppLocale } from "@/i18n/routing";
import { getDb, schema } from "@/lib/db";
import { isAppLocale, LOCALE_COOKIE_NAME } from "@/lib/i18n/geo-locale.shared";
import {
  loadUserLocaleState,
  loadUserLocaleStates,
  type UserLocaleState,
} from "@/lib/i18n/user-locale.server";

/**
 * Single entry point for the language of anything sent to one person
 * (email, Discord DM, future push). Precedence: the recipient's manual pick,
 * then their LastRank country, then `fallback` (e.g. the requesting browser's
 * locale for sign-in emails), then en-US.
 */

const MESSAGES: Record<AppLocale, Record<string, unknown>> = {
  "en-US": enUS,
  "pt-BR": ptBR,
  id: idMessages,
};

function withFallback(
  state: UserLocaleState | undefined,
  fallback: string | null | undefined,
): AppLocale {
  if (state && state.source !== "default") return state.locale;
  return isAppLocale(fallback) ? fallback : (state?.locale ?? "en-US");
}

async function hqUserIdForEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const [row] = await getDb()
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(sql`lower(${schema.hqUsers.email})`, normalized))
    .limit(1);
  return row?.id ?? null;
}

export async function resolveRecipientLocale(input: {
  hqUserId?: string | null;
  email?: string | null;
  fallback?: string | null;
}): Promise<AppLocale> {
  try {
    const hqUserId =
      input.hqUserId ?? (input.email ? await hqUserIdForEmail(input.email) : null);
    if (!hqUserId) return isAppLocale(input.fallback) ? input.fallback : "en-US";
    return withFallback(await loadUserLocaleState(hqUserId), input.fallback);
  } catch {
    return isAppLocale(input.fallback) ? input.fallback : "en-US";
  }
}

/**
 * Sign-up / sign-in emails before the recipient is authenticated. Uses only the
 * requesting browser's locale so message language cannot reveal whether the
 * address already has an HQ account.
 */
export async function resolvePreAuthEmailLocale(): Promise<AppLocale> {
  try {
    const fallback = await requestLocaleFallback();
    return isAppLocale(fallback) ? fallback : "en-US";
  } catch {
    return "en-US";
  }
}

/** Batch form for multi-recipient sends; missing users resolve to en-US. */
export async function resolveRecipientLocales(
  hqUserIds: string[],
): Promise<Map<string, AppLocale>> {
  const states = await loadUserLocaleStates(hqUserIds);
  return new Map(
    hqUserIds.map((id) => [id, withFallback(states.get(id), null)] as const),
  );
}

/**
 * Discord DMs: linked users resolve exactly like their emails (a stale
 * `/language` row is ignored once they go back to automatic); unlinked users
 * keep their `/language` choice, then en-US.
 */
export async function resolveDiscordRecipientLocales(
  discordUserIds: string[],
): Promise<Map<string, AppLocale>> {
  const ids = [...new Set(discordUserIds)];
  if (ids.length === 0) return new Map();
  const db = getDb();
  const [links, prefs] = await Promise.all([
    db
      .select({
        discordUserId: schema.discordHqLinks.discordUserId,
        hqUserId: schema.discordHqLinks.hqUserId,
      })
      .from(schema.discordHqLinks)
      .where(inArray(schema.discordHqLinks.discordUserId, ids)),
    db
      .select({
        discordUserId: schema.discordUserPrefs.discordUserId,
        locale: schema.discordUserPrefs.locale,
      })
      .from(schema.discordUserPrefs)
      .where(inArray(schema.discordUserPrefs.discordUserId, ids)),
  ]);
  const states = await loadUserLocaleStates(
    links.map((link) => link.hqUserId).filter((id): id is string => !!id),
  );
  return new Map(
    ids.map((id) => {
      const link = links.find((row) => row.discordUserId === id);
      if (link?.hqUserId) {
        return [id, withFallback(states.get(link.hqUserId), null)] as const;
      }
      const pref = prefs.find((row) => row.discordUserId === id)?.locale;
      return [id, isAppLocale(pref) ? pref : "en-US"] as const;
    }),
  );
}

export async function resolveDiscordRecipientLocale(
  discordUserId: string,
): Promise<AppLocale> {
  const locales = await resolveDiscordRecipientLocales([discordUserId]);
  return locales.get(discordUserId) ?? "en-US";
}

/** Locale of the browser making the current request, when there is one. */
export async function requestLocaleFallback(): Promise<AppLocale | null> {
  try {
    const { cookies } = await import("next/headers");
    const value = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
    return isAppLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export type NotificationTranslate = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/** Translator scoped to a namespace (e.g. `notifications.rosterLink`). */
export function notificationTranslator(
  locale: AppLocale,
  namespace: string,
): NotificationTranslate {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale] ?? MESSAGES["en-US"],
  });
  return (key, values) =>
    (t as unknown as (k: string, v?: unknown) => string)(
      `${namespace}.${key}`,
      values,
    );
}

/** Locale-aware number formatting for notification bodies. */
export function formatNotificationNumber(
  value: number,
  locale: AppLocale,
): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Locale-aware date formatting; notifications default to UTC dates. */
export function formatNotificationDate(
  date: Date,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long", timeZone: "UTC" },
): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}
