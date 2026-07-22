import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/discord/channel-setter-auth.server", () => ({
  resolveDiscordChannelSetterAccess: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getGuildAllianceId: vi.fn(),
  getAllianceById: vi.fn(),
  setGuildBankingChannel: vi.fn(),
  setGuildRegularEventsChannel: vi.fn(),
  setGuildSeasonalEventsChannel: vi.fn(),
}));

import { resolveDiscordChannelSetterAccess } from "@/lib/discord/channel-setter-auth.server";
import {
  handleDiscordSetBankingChannel,
  handleDiscordSetRegularEventsChannel,
  handleDiscordSetSeasonalEventsChannel,
} from "@/lib/battle-plan/discord-channel-handlers.server";
import {
  getAllianceById,
  getGuildAllianceId,
  setGuildBankingChannel,
} from "@/lib/vr/repository";

describe("battle-plan Discord channel setters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGuildAllianceId).mockResolvedValue("alliance-1");
    vi.mocked(getAllianceById).mockResolvedValue({ tag: "LFgo" } as never);
  });

  it("returns a translated denial (not a raw i18n key) when R4 is blocked", async () => {
    vi.mocked(resolveDiscordChannelSetterAccess).mockResolvedValue({
      allowed: false,
      minRank: "owner",
      denialKey: "channelSetter.deniedOwnerOnly",
    });

    const result = await handleDiscordSetBankingChannel({
      guildId: "g1",
      channelId: "c1",
      discordUserId: "d1",
      locale: "en-US",
    });

    expect(result.reply).not.toMatch(/errors\.|channelSetter\./);
    expect(result.reply).toMatch(/R5|owner/i);
    expect(setGuildBankingChannel).not.toHaveBeenCalled();
  });

  it("allows an officer when the shared gate permits", async () => {
    vi.mocked(resolveDiscordChannelSetterAccess).mockResolvedValue({
      allowed: true,
      minRank: "officer",
    });

    const result = await handleDiscordSetBankingChannel({
      guildId: "g1",
      channelId: "c1",
      discordUserId: "d1",
      locale: "en-US",
    });

    expect(setGuildBankingChannel).toHaveBeenCalledWith("g1", "c1");
    expect(result.reply).toMatch(/LFgo/);
    expect(result.reply).toMatch(/<#c1>/);
  });

  it("gates seasonal and regular event channels the same way", async () => {
    vi.mocked(resolveDiscordChannelSetterAccess).mockResolvedValue({
      allowed: false,
      minRank: "officer",
      denialKey: "channelSetter.deniedOfficer",
    });

    const seasonal = await handleDiscordSetSeasonalEventsChannel({
      guildId: "g1",
      channelId: "c1",
      discordUserId: "d1",
      locale: "en-US",
    });
    const regular = await handleDiscordSetRegularEventsChannel({
      guildId: "g1",
      channelId: "c1",
      discordUserId: "d1",
      locale: "en-US",
    });

    expect(seasonal.reply).toMatch(/R4/i);
    expect(regular.reply).toMatch(/R4/i);
    expect(seasonal.reply).not.toContain("errors.ownerOnly");
    expect(regular.reply).not.toContain("errors.ownerOnly");
  });
});
