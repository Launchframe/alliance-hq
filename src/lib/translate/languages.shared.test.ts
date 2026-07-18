import { describe, expect, it } from "vitest";

import {
  TRANSLATION_LANGUAGES,
  isSupportedTranslationLanguage,
  normalizeTranslationLanguage,
  translationLanguageFromDiscordLocale,
  translationLanguageName,
} from "@/lib/translate/languages.shared";

describe("TRANSLATION_LANGUAGES", () => {
  it("fits Discord's 25-choice limit on slash command options", () => {
    expect(TRANSLATION_LANGUAGES.length).toBeLessThanOrEqual(25);
  });

  it("has unique codes", () => {
    const codes = TRANSLATION_LANGUAGES.map((l) => l.code.toLowerCase());
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("normalizeTranslationLanguage", () => {
  it("canonicalizes case and whitespace", () => {
    expect(normalizeTranslationLanguage(" PT ")).toBe("pt");
    expect(normalizeTranslationLanguage("zh-cn")).toBe("zh-CN");
    expect(normalizeTranslationLanguage("ZH-TW")).toBe("zh-TW");
  });

  it("rejects unsupported and empty codes", () => {
    expect(normalizeTranslationLanguage("xx")).toBeNull();
    expect(normalizeTranslationLanguage("")).toBeNull();
    expect(normalizeTranslationLanguage(null)).toBeNull();
    expect(normalizeTranslationLanguage(undefined)).toBeNull();
  });
});

describe("isSupportedTranslationLanguage", () => {
  it("accepts every listed language", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      expect(isSupportedTranslationLanguage(language.code)).toBe(true);
    }
  });

  it("rejects unknown codes", () => {
    expect(isSupportedTranslationLanguage("klingon")).toBe(false);
  });
});

describe("translationLanguageName", () => {
  it("returns the native endonym", () => {
    expect(translationLanguageName("pt")).toBe("Português");
    expect(translationLanguageName("ko")).toBe("한국어");
  });

  it("falls back to the raw code for unknown languages", () => {
    expect(translationLanguageName("xx")).toBe("xx");
  });
});

describe("translationLanguageFromDiscordLocale", () => {
  it("maps regional locales onto base languages", () => {
    expect(translationLanguageFromDiscordLocale("pt-BR")).toBe("pt");
    expect(translationLanguageFromDiscordLocale("es-419")).toBe("es");
    expect(translationLanguageFromDiscordLocale("es-ES")).toBe("es");
    expect(translationLanguageFromDiscordLocale("en-US")).toBe("en");
    expect(translationLanguageFromDiscordLocale("en-GB")).toBe("en");
  });

  it("keeps meaningful Chinese variants distinct", () => {
    expect(translationLanguageFromDiscordLocale("zh-CN")).toBe("zh-CN");
    expect(translationLanguageFromDiscordLocale("zh-TW")).toBe("zh-TW");
  });

  it("passes supported base locales through", () => {
    expect(translationLanguageFromDiscordLocale("fr")).toBe("fr");
    expect(translationLanguageFromDiscordLocale("uk")).toBe("uk");
  });

  it("falls back to English for unsupported or missing locales", () => {
    expect(translationLanguageFromDiscordLocale("sv-SE")).toBe("en");
    expect(translationLanguageFromDiscordLocale("no")).toBe("en");
    expect(translationLanguageFromDiscordLocale(null)).toBe("en");
    expect(translationLanguageFromDiscordLocale(undefined)).toBe("en");
  });
});
