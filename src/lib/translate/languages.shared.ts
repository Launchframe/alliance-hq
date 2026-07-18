/**
 * Supported target languages for Discord message translation.
 *
 * Codes are Google Cloud Translation v2 language codes. The list is capped at
 * 24 entries so it fits Discord's 25-choice limit on slash command options.
 * Display names are native-language endonyms so members can find their own
 * language without reading English.
 */
export type TranslationLanguage = {
  /** Google Translation v2 target code (also stored in discord_user_prefs). */
  code: string;
  /** Native display name shown in slash command choices and replies. */
  name: string;
};

export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  { code: "en", name: "English" },
  { code: "pt", name: "Português" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "tr", name: "Türkçe" },
  { code: "ar", name: "العربية" },
  { code: "ko", name: "한국어" },
  { code: "ja", name: "日本語" },
  { code: "zh-CN", name: "中文（简体）" },
  { code: "zh-TW", name: "中文（繁體）" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ไทย" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "tl", name: "Filipino" },
  { code: "hi", name: "हिन्दी" },
  { code: "el", name: "Ελληνικά" },
  { code: "hu", name: "Magyar" },
] as const;

const LANGUAGE_BY_CODE = new Map(
  TRANSLATION_LANGUAGES.map((language) => [language.code.toLowerCase(), language]),
);

export function isSupportedTranslationLanguage(code: string | null | undefined): boolean {
  if (!code) return false;
  return LANGUAGE_BY_CODE.has(code.trim().toLowerCase());
}

/** Returns the canonical language code, or null when unsupported. */
export function normalizeTranslationLanguage(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const language = LANGUAGE_BY_CODE.get(code.trim().toLowerCase());
  return language?.code ?? null;
}

/** Native display name for a supported code; falls back to the raw code. */
export function translationLanguageName(code: string): string {
  return LANGUAGE_BY_CODE.get(code.trim().toLowerCase())?.name ?? code;
}

/**
 * Map a Discord client locale (e.g. `pt-BR`, `es-419`, `zh-CN`) onto a
 * supported translation language. Regional Chinese variants are meaningful
 * translation targets, so they map as-is; everything else maps by base
 * language. Unsupported locales fall back to English.
 */
export function translationLanguageFromDiscordLocale(
  discordLocale: string | null | undefined,
): string {
  if (!discordLocale) return "en";
  const trimmed = discordLocale.trim();
  const exact = normalizeTranslationLanguage(trimmed);
  if (exact) return exact;
  const base = normalizeTranslationLanguage(trimmed.split("-")[0]);
  return base ?? "en";
}
