import "server-only";

import { createHash } from "node:crypto";

import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import {
  normalizeTranslationLanguage,
  translationLanguageFromDiscordLocale,
  translationLanguageName,
} from "@/lib/translate/languages.shared";
import {
  getCachedMessageTranslation,
  getGuildTranslationEnabled,
  getTranslationLanguagePref,
  setGuildTranslationEnabled,
  upsertCachedMessageTranslation,
  upsertTranslationLanguagePref,
} from "@/lib/translate/repository.server";
import {
  TRANSLATION_INPUT_MAX_CHARS,
  isTranslationConfigured,
  translateText,
} from "@/lib/translate/translate.server";
import {
  callerIsAllianceOwner,
  getAllianceById,
  getGuildAllianceId,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";

export type TranslateBotReply = { reply: string };

async function audit(
  allianceId: string | null,
  discordUserId: string,
  command: string,
  payload: unknown,
  result: unknown,
) {
  if (!allianceId) return;
  try {
    await writeDiscordBotAudit({
      allianceId,
      discordUserId,
      command,
      payload,
      result,
    });
  } catch (error) {
    console.error("[discord-bot] audit log failed", error);
  }
}

/** Stored preference wins; otherwise infer from the caller's Discord client locale. */
export async function resolveTranslationTargetLanguage(
  discordUserId: string,
  payloadLocale: string | undefined,
): Promise<string> {
  const stored = await getTranslationLanguagePref(discordUserId);
  if (stored) return stored;
  return translationLanguageFromDiscordLocale(payloadLocale);
}

// ---------------------------------------------------------------------------
// Apps → Translate (message context menu)
// ---------------------------------------------------------------------------

export async function handleDiscordTranslateMessage(input: {
  allianceId: string;
  guildId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  payloadLocale: string | undefined;
  message: { id: string; content: string };
}): Promise<TranslateBotReply> {
  const t = createDiscordTranslator(input.locale);

  if (!isTranslationConfigured()) {
    return { reply: t("translate.notConfigured") };
  }

  const enabled = await getGuildTranslationEnabled(input.guildId);
  if (!enabled) {
    return { reply: t("translate.disabled") };
  }

  const content = input.message.content.trim();
  if (!content) {
    return { reply: t("translate.nothingToTranslate") };
  }
  if (content.length > TRANSLATION_INPUT_MAX_CHARS) {
    return {
      reply: t("translate.tooLong", { max: TRANSLATION_INPUT_MAX_CHARS }),
    };
  }

  const targetLanguage = await resolveTranslationTargetLanguage(
    input.discordUserId,
    input.payloadLocale,
  );
  const contentHash = createHash("sha256").update(content, "utf8").digest("hex");

  // Never log or audit message content — only metadata about the request.
  const auditPayload = {
    messageId: input.message.id,
    targetLanguage,
    contentLength: content.length,
  };

  const cached = await getCachedMessageTranslation({
    messageId: input.message.id,
    targetLanguage,
    contentHash,
  });
  let translatedText: string;
  let detectedSourceLanguage: string | null;
  if (cached) {
    translatedText = cached.translatedText;
    detectedSourceLanguage = cached.detectedSourceLanguage;
  } else {
    const result = await translateText({ text: content, targetLanguage });
    translatedText = result.translatedText;
    detectedSourceLanguage = result.detectedSourceLanguage;
    await upsertCachedMessageTranslation({
      messageId: input.message.id,
      targetLanguage,
      contentHash,
      translatedText,
      detectedSourceLanguage,
    });
  }

  await audit(input.allianceId, input.discordUserId, "translate_message", auditPayload, {
    cached: Boolean(cached),
    detectedSourceLanguage,
  });

  const normalizedSource = normalizeTranslationLanguage(detectedSourceLanguage);
  if (normalizedSource && normalizedSource === targetLanguage) {
    return {
      reply: t("translate.sameLanguage", {
        language: translationLanguageName(targetLanguage),
      }),
    };
  }

  const target = translationLanguageName(targetLanguage);
  if (normalizedSource) {
    return {
      reply: t("translate.result", {
        text: translatedText,
        source: translationLanguageName(normalizedSource),
        target,
      }),
    };
  }
  return {
    reply: t("translate.resultNoSource", { text: translatedText, target }),
  };
}

// ---------------------------------------------------------------------------
// /translation-language
// ---------------------------------------------------------------------------

export async function handleDiscordTranslationLanguage(input: {
  discordUserId: string;
  locale: DiscordBotLocale;
  languageCode: string | undefined;
}): Promise<TranslateBotReply> {
  const t = createDiscordTranslator(input.locale);
  const normalized = normalizeTranslationLanguage(input.languageCode);
  if (!normalized) {
    return { reply: t("translate.invalidLanguage") };
  }
  await upsertTranslationLanguagePref(input.discordUserId, normalized);
  return {
    reply: t("translate.languageUpdated", {
      language: translationLanguageName(normalized),
    }),
  };
}

// ---------------------------------------------------------------------------
// /set-translation (owner only)
// ---------------------------------------------------------------------------

export async function handleDiscordSetTranslation(input: {
  guildId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  enabled: boolean;
}): Promise<TranslateBotReply> {
  const t = createDiscordTranslator(input.locale);
  const registeredAllianceId = await getGuildAllianceId(input.guildId);
  if (!registeredAllianceId) {
    return { reply: t("errors.guildNotRegistered") };
  }

  const isOwner = await callerIsAllianceOwner({
    allianceId: registeredAllianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) {
    const reply = t("errors.notOwner");
    await audit(registeredAllianceId, input.discordUserId, "set_translation", input, {
      reply,
    });
    return { reply };
  }

  await setGuildTranslationEnabled(input.guildId, input.enabled);
  const alliance = await getAllianceById(registeredAllianceId);
  const reply = input.enabled
    ? t("translate.enabledSuccess", { tag: alliance?.tag ?? "?" })
    : t("translate.disabledSuccess", { tag: alliance?.tag ?? "?" });
  await audit(registeredAllianceId, input.discordUserId, "set_translation", input, {
    reply,
  });
  return { reply };
}
