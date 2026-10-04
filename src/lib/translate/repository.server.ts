import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { normalizeTranslationLanguage } from "@/lib/translate/languages.shared";

/** Cached rows older than this are treated as expired and cleaned lazily. */
const TRANSLATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function getTranslationLanguagePref(
  discordUserId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ translationLanguage: schema.discordUserPrefs.translationLanguage })
    .from(schema.discordUserPrefs)
    .where(eq(schema.discordUserPrefs.discordUserId, discordUserId))
    .limit(1);
  return normalizeTranslationLanguage(row?.translationLanguage);
}

export async function upsertTranslationLanguagePref(
  discordUserId: string,
  translationLanguage: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.discordUserPrefs)
    .values({
      discordUserId,
      translationLanguage,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.discordUserPrefs.discordUserId,
      set: { translationLanguage, updatedAt: new Date() },
    });
}

export async function getGuildTranslationEnabled(
  guildId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ translationEnabled: schema.discordGuildAlliances.translationEnabled })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.guildId, guildId))
    .limit(1);
  return row?.translationEnabled ?? true;
}

export async function setGuildTranslationEnabled(
  guildId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.discordGuildAlliances)
    .set({ translationEnabled: enabled })
    .where(eq(schema.discordGuildAlliances.guildId, guildId));
}

export async function getCachedMessageTranslation(input: {
  messageId: string;
  targetLanguage: string;
  contentHash: string;
}): Promise<{ translatedText: string; detectedSourceLanguage: string | null } | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordMessageTranslations)
    .where(
      and(
        eq(schema.discordMessageTranslations.messageId, input.messageId),
        eq(schema.discordMessageTranslations.targetLanguage, input.targetLanguage),
      ),
    )
    .limit(1);
  if (!row) return null;
  // A different hash means the message was edited since we cached it.
  if (row.contentHash !== input.contentHash) return null;
  if (row.createdAt.getTime() < Date.now() - TRANSLATION_CACHE_TTL_MS) return null;
  return {
    translatedText: row.translatedText,
    detectedSourceLanguage: row.detectedSourceLanguage,
  };
}

export async function upsertCachedMessageTranslation(input: {
  messageId: string;
  targetLanguage: string;
  contentHash: string;
  translatedText: string;
  detectedSourceLanguage: string | null;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.discordMessageTranslations)
    .values({
      messageId: input.messageId,
      targetLanguage: input.targetLanguage,
      contentHash: input.contentHash,
      translatedText: input.translatedText,
      detectedSourceLanguage: input.detectedSourceLanguage,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.discordMessageTranslations.messageId,
        schema.discordMessageTranslations.targetLanguage,
      ],
      set: {
        contentHash: input.contentHash,
        translatedText: input.translatedText,
        detectedSourceLanguage: input.detectedSourceLanguage,
        createdAt: new Date(),
      },
    });
  // Lazy hygiene: drop expired rows so the cache table does not grow unbounded.
  await db
    .delete(schema.discordMessageTranslations)
    .where(
      lt(
        schema.discordMessageTranslations.createdAt,
        new Date(Date.now() - TRANSLATION_CACHE_TTL_MS),
      ),
    );
}
