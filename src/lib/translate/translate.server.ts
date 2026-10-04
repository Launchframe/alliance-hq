import "server-only";

/**
 * Text translation provider for Discord message translation.
 *
 * Backed by Google Cloud Translation v2 (same API and key as the maintainer
 * i18n script, but invoked at runtime). Kept behind a narrow interface so an
 * LLM-backed provider can be swapped in later without touching handlers.
 */

export const TRANSLATION_INPUT_MAX_CHARS = 4000;

export type TranslationResult = {
  translatedText: string;
  /** Source language detected by the provider (v2 code), when reported. */
  detectedSourceLanguage: string | null;
};

export function isTranslationConfigured(): boolean {
  return Boolean(process.env.GOOGLE_TRANSLATE_API_KEY?.trim());
}

export async function translateText(input: {
  text: string;
  targetLanguage: string;
}): Promise<TranslationResult> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_TRANSLATE_API_KEY is not configured.");
  }
  if (input.text.length > TRANSLATION_INPUT_MAX_CHARS) {
    throw new Error(
      `Translation input exceeds ${TRANSLATION_INPUT_MAX_CHARS} characters.`,
    );
  }

  const url = new URL("https://translation.googleapis.com/language/translate/v2");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: input.text,
      target: input.targetLanguage,
      format: "text",
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    data?: {
      translations?: Array<{
        translatedText?: string;
        detectedSourceLanguage?: string;
      }>;
    };
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        `Translation API failed with status ${response.status}`,
    );
  }

  const translation = payload?.data?.translations?.[0];
  if (typeof translation?.translatedText !== "string") {
    throw new Error("Translation API returned no translation.");
  }

  return {
    translatedText: translation.translatedText,
    detectedSourceLanguage: translation.detectedSourceLanguage ?? null,
  };
}
