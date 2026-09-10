import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/translate/repository.server", () => ({
  getCachedMessageTranslation: vi.fn(),
  getGuildTranslationEnabled: vi.fn(),
  getTranslationLanguagePref: vi.fn(),
  setGuildTranslationEnabled: vi.fn(),
  upsertCachedMessageTranslation: vi.fn(),
  upsertTranslationLanguagePref: vi.fn(),
}));

vi.mock("@/lib/translate/translate.server", () => ({
  TRANSLATION_INPUT_MAX_CHARS: 4000,
  isTranslationConfigured: vi.fn(),
  translateText: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  callerIsAllianceOwner: vi.fn(),
  getAllianceById: vi.fn(),
  getGuildAllianceId: vi.fn(),
  writeDiscordBotAudit: vi.fn(),
}));

import {
  getCachedMessageTranslation,
  getGuildTranslationEnabled,
  getTranslationLanguagePref,
  setGuildTranslationEnabled,
  upsertCachedMessageTranslation,
  upsertTranslationLanguagePref,
} from "@/lib/translate/repository.server";
import {
  isTranslationConfigured,
  translateText,
} from "@/lib/translate/translate.server";
import {
  callerIsAllianceOwner,
  getAllianceById,
  getGuildAllianceId,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import {
  handleDiscordSetTranslation,
  handleDiscordTranslateMessage,
  handleDiscordTranslationLanguage,
  resolveTranslationTargetLanguage,
} from "@/lib/translate/discord-handlers.server";

const baseTranslateInput = {
  allianceId: "alliance-1",
  guildId: "guild-1",
  discordUserId: "user-1",
  locale: "en-US" as const,
  payloadLocale: "en-US",
  message: { id: "msg-1", content: "Hello" },
};

describe("resolveTranslationTargetLanguage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers stored translation language over Discord locale", async () => {
    vi.mocked(getTranslationLanguagePref).mockResolvedValue("pt");
    await expect(
      resolveTranslationTargetLanguage("user-1", "en-US"),
    ).resolves.toBe("pt");
  });

  it("falls back to Discord locale when no pref is stored", async () => {
    vi.mocked(getTranslationLanguagePref).mockResolvedValue(null);
    await expect(
      resolveTranslationTargetLanguage("user-1", "pt-BR"),
    ).resolves.toBe("pt");
  });
});

describe("handleDiscordTranslateMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTranslationConfigured).mockReturnValue(true);
    vi.mocked(getGuildTranslationEnabled).mockResolvedValue(true);
    vi.mocked(getTranslationLanguagePref).mockResolvedValue("pt");
    vi.mocked(getCachedMessageTranslation).mockResolvedValue(null);
    vi.mocked(translateText).mockResolvedValue({
      translatedText: "Olá",
      detectedSourceLanguage: "en",
    });
  });

  it("returns notConfigured when GOOGLE_TRANSLATE_API_KEY is unset", async () => {
    vi.mocked(isTranslationConfigured).mockReturnValue(false);
    const result = await handleDiscordTranslateMessage(baseTranslateInput);
    expect(result.reply).toMatch(/isn't available/i);
    expect(translateText).not.toHaveBeenCalled();
    expect(writeDiscordBotAudit).not.toHaveBeenCalled();
  });

  it("returns disabled when guild translation is turned off", async () => {
    vi.mocked(getGuildTranslationEnabled).mockResolvedValue(false);
    const result = await handleDiscordTranslateMessage(baseTranslateInput);
    expect(result.reply).toMatch(/turned off/i);
    expect(translateText).not.toHaveBeenCalled();
  });

  it("returns nothingToTranslate for whitespace-only content", async () => {
    const result = await handleDiscordTranslateMessage({
      ...baseTranslateInput,
      message: { id: "msg-1", content: "   " },
    });
    expect(result.reply).toMatch(/no text to translate/i);
  });

  it("returns tooLong when content exceeds the cap", async () => {
    const result = await handleDiscordTranslateMessage({
      ...baseTranslateInput,
      message: { id: "msg-1", content: "a".repeat(4001) },
    });
    expect(result.reply).toMatch(/too long/i);
  });

  it("uses cache hits and skips the provider", async () => {
    vi.mocked(getCachedMessageTranslation).mockResolvedValue({
      translatedText: "Olá",
      detectedSourceLanguage: "en",
    });
    const result = await handleDiscordTranslateMessage(baseTranslateInput);
    expect(result.reply).toContain("Olá");
    expect(translateText).not.toHaveBeenCalled();
    expect(upsertCachedMessageTranslation).not.toHaveBeenCalled();
    expect(writeDiscordBotAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "translate_message",
        payload: expect.objectContaining({
          messageId: "msg-1",
          targetLanguage: "pt",
          contentLength: 5,
        }),
        result: expect.objectContaining({ cached: true }),
      }),
    );
  });

  it("translates on cache miss and stores the result", async () => {
    await handleDiscordTranslateMessage(baseTranslateInput);
    expect(translateText).toHaveBeenCalledWith({
      text: "Hello",
      targetLanguage: "pt",
    });
    expect(upsertCachedMessageTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg-1",
        targetLanguage: "pt",
        translatedText: "Olá",
        detectedSourceLanguage: "en",
        contentHash: expect.any(String),
      }),
    );
  });

  it("returns sameLanguage when detected source matches target", async () => {
    vi.mocked(translateText).mockResolvedValue({
      translatedText: "Olá",
      detectedSourceLanguage: "pt",
    });
    const result = await handleDiscordTranslateMessage(baseTranslateInput);
    expect(result.reply).toMatch(/already in/i);
  });

  it("never puts message content in audit payload", async () => {
    await handleDiscordTranslateMessage(baseTranslateInput);
    const auditCall = vi.mocked(writeDiscordBotAudit).mock.calls[0]?.[0];
    expect(JSON.stringify(auditCall?.payload)).not.toContain("Hello");
    expect(JSON.stringify(auditCall?.result)).not.toContain("Olá");
  });
});

describe("handleDiscordTranslationLanguage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unsupported language codes", async () => {
    const result = await handleDiscordTranslationLanguage({
      discordUserId: "user-1",
      locale: "en-US",
      languageCode: "klingon",
    });
    expect(result.reply).toMatch(/Pick a language/i);
    expect(upsertTranslationLanguagePref).not.toHaveBeenCalled();
  });

  it("stores a normalized supported language", async () => {
    const result = await handleDiscordTranslationLanguage({
      discordUserId: "user-1",
      locale: "en-US",
      languageCode: " PT ",
    });
    expect(result.reply).toMatch(/Português/i);
    expect(upsertTranslationLanguagePref).toHaveBeenCalledWith("user-1", "pt");
  });
});

describe("handleDiscordSetTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGuildAllianceId).mockResolvedValue("alliance-1");
    vi.mocked(getAllianceById).mockResolvedValue({ tag: "LFgo" } as never);
  });

  it("returns guildNotRegistered when the guild is not linked", async () => {
    vi.mocked(getGuildAllianceId).mockResolvedValue(null);
    const result = await handleDiscordSetTranslation({
      guildId: "guild-1",
      discordUserId: "user-1",
      locale: "en-US",
      enabled: true,
    });
    expect(result.reply).toMatch(/not linked/i);
    expect(setGuildTranslationEnabled).not.toHaveBeenCalled();
  });

  it("rejects non-owners", async () => {
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(false);
    const result = await handleDiscordSetTranslation({
      guildId: "guild-1",
      discordUserId: "user-1",
      locale: "en-US",
      enabled: false,
    });
    expect(result.reply).toMatch(/owner/i);
    expect(setGuildTranslationEnabled).not.toHaveBeenCalled();
    expect(writeDiscordBotAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "set_translation" }),
    );
  });

  it("toggles translation for alliance owners", async () => {
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(true);
    const result = await handleDiscordSetTranslation({
      guildId: "guild-1",
      discordUserId: "user-1",
      locale: "en-US",
      enabled: true,
    });
    expect(result.reply).toMatch(/LFgo/);
    expect(setGuildTranslationEnabled).toHaveBeenCalledWith("guild-1", true);
  });
});
