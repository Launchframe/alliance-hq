import "server-only";

import { createHash } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  isTranslationConfigured,
  translateText,
} from "@/lib/translate/translate.server";
import {
  normalizeTranslationLanguage,
  translationLanguageFromHqLocale,
} from "@/lib/translate/languages.shared";

const TRANSLATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashOfficerChatText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function getCachedOfficerChatTranslation(input: {
  allianceId: string;
  contentHash: string;
  targetLanguage: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerChatTranslations)
    .where(
      and(
        eq(schema.officerChatTranslations.allianceId, input.allianceId),
        eq(schema.officerChatTranslations.contentHash, input.contentHash),
        eq(schema.officerChatTranslations.targetLanguage, input.targetLanguage),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.createdAt.getTime() > TRANSLATION_CACHE_TTL_MS) {
    await db
      .delete(schema.officerChatTranslations)
      .where(eq(schema.officerChatTranslations.id, row.id));
    return null;
  }
  return row;
}

async function upsertOfficerChatTranslation(input: {
  allianceId: string;
  contentHash: string;
  targetLanguage: string;
  translatedText: string;
  detectedSourceLanguage: string | null;
}) {
  const db = getDb();
  await db
    .insert(schema.officerChatTranslations)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      contentHash: input.contentHash,
      targetLanguage: input.targetLanguage,
      translatedText: input.translatedText,
      detectedSourceLanguage: input.detectedSourceLanguage,
    })
    .onConflictDoUpdate({
      target: [
        schema.officerChatTranslations.allianceId,
        schema.officerChatTranslations.contentHash,
        schema.officerChatTranslations.targetLanguage,
      ],
      set: {
        translatedText: input.translatedText,
        detectedSourceLanguage: input.detectedSourceLanguage,
        createdAt: new Date(),
      },
    });
}

export type LocaleTextResult = {
  localeText: string;
  localeCode: string;
  translationUnavailable: boolean;
};

export async function resolveOfficerChatLocaleText(input: {
  allianceId: string;
  originalText: string;
  hqLocale: string;
}): Promise<LocaleTextResult> {
  const localeCode = input.hqLocale;
  const targetLanguage = translationLanguageFromHqLocale(input.hqLocale);
  const trimmed = input.originalText.trim();
  if (!trimmed) {
    return {
      localeText: "",
      localeCode,
      translationUnavailable: false,
    };
  }

  if (!isTranslationConfigured()) {
    return {
      localeText: trimmed,
      localeCode,
      translationUnavailable: true,
    };
  }

  const contentHash = hashOfficerChatText(trimmed);
  const cached = await getCachedOfficerChatTranslation({
    allianceId: input.allianceId,
    contentHash,
    targetLanguage,
  });
  if (cached) {
    return {
      localeText: cached.translatedText,
      localeCode,
      translationUnavailable: false,
    };
  }

  const result = await translateText({
    text: trimmed,
    targetLanguage,
  });
  const normalizedSource = normalizeTranslationLanguage(
    result.detectedSourceLanguage,
  );
  if (normalizedSource === targetLanguage) {
    return {
      localeText: trimmed,
      localeCode,
      translationUnavailable: false,
    };
  }

  await upsertOfficerChatTranslation({
    allianceId: input.allianceId,
    contentHash,
    targetLanguage,
    translatedText: result.translatedText,
    detectedSourceLanguage: result.detectedSourceLanguage,
  });

  return {
    localeText: result.translatedText,
    localeCode,
    translationUnavailable: false,
  };
}

/** Lazy TTL cleanup for expired cache rows (best-effort). */
export async function pruneExpiredOfficerChatTranslations(): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - TRANSLATION_CACHE_TTL_MS);
  await db
    .delete(schema.officerChatTranslations)
    .where(lt(schema.officerChatTranslations.createdAt, cutoff));
}
