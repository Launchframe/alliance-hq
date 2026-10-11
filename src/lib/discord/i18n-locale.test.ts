import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDiscordHqLink: vi.fn(),
  getDiscordUserLocale: vi.fn(),
  upsertDiscordUserLocale: vi.fn(),
  loadUserLocaleState: vi.fn(),
  setManualPreferredLocale: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getDiscordHqLink: mocks.getDiscordHqLink,
  getDiscordUserLocale: mocks.getDiscordUserLocale,
  upsertDiscordUserLocale: mocks.upsertDiscordUserLocale,
}));

vi.mock("@/lib/i18n/user-locale.server", () => ({
  loadUserLocaleState: mocks.loadUserLocaleState,
  setManualPreferredLocale: mocks.setManualPreferredLocale,
}));

import { getDiscordBotLocale, setDiscordBotLocale } from "./i18n";

describe("getDiscordBotLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDiscordUserLocale.mockResolvedValue("pt-BR");
  });

  it("follows the HQ manual or LastRank locale for linked users", async () => {
    mocks.getDiscordHqLink.mockResolvedValue({ hqUserId: "u1" });
    mocks.loadUserLocaleState.mockResolvedValue({ locale: "id", source: "lastrank" });
    await expect(getDiscordBotLocale("d1", "en-US")).resolves.toBe("id");
    expect(mocks.getDiscordUserLocale).not.toHaveBeenCalled();
  });

  it("ignores a stale /language row once a linked user goes back to automatic", async () => {
    mocks.getDiscordHqLink.mockResolvedValue({ hqUserId: "u1" });
    mocks.loadUserLocaleState.mockResolvedValue({ locale: "en-US", source: "default" });
    await expect(getDiscordBotLocale("d1", "id")).resolves.toBe("id");
  });

  it("keeps /language for unlinked users", async () => {
    mocks.getDiscordHqLink.mockResolvedValue(null);
    await expect(getDiscordBotLocale("d1", "en-US")).resolves.toBe("pt-BR");
  });
});

describe("setDiscordBotLocale", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records /language as a manual HQ pick for linked users", async () => {
    mocks.getDiscordHqLink.mockResolvedValue({ hqUserId: "u1" });
    await setDiscordBotLocale("d1", "pt-BR");
    expect(mocks.upsertDiscordUserLocale).toHaveBeenCalledWith("d1", "pt-BR");
    expect(mocks.setManualPreferredLocale).toHaveBeenCalledWith("u1", "pt-BR", {
      syncDiscord: false,
    });
  });
});
