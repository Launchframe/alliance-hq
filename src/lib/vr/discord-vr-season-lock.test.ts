import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDiscordTranslator } from "@/lib/discord/i18n";

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveMaxBaseVrForAlliance: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  countSeasonReporters: vi.fn(),
  getDiscordBotPending: vi.fn(),
  getDiscordLinkById: vi.fn(),
  getMemberSeasonHigh: vi.fn(),
  listDiscordLinksForUser: vi.fn(),
  listSeasonVrRows: vi.fn(),
  resolveVrSeasonContext: vi.fn(),
  saveDiscordBotPending: vi.fn(),
  upsertMemberSeasonVr: vi.fn(),
  writeDiscordBotAudit: vi.fn(),
}));

import {
  listDiscordLinksForUser,
  resolveVrSeasonContext,
  upsertMemberSeasonVr,
} from "@/lib/vr/repository";
import { handleDiscordVrSlash } from "@/lib/vr/service";

const lockedSeason = {
  seasonKey: "4",
  isPostSeason: true,
  vrUpdatesLocked: true,
  priorSeason: "4",
};

describe("handleDiscordVrSlash post-season lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveVrSeasonContext).mockResolvedValue(lockedSeason);
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      {
        id: "link-1",
        allianceId: "alliance-1",
        discordUserId: "discord-1",
        ashedMemberId: "member-1",
        memberDisplayName: "Tester",
      },
    ] as never);
  });

  it("returns localized seasonLocked copy for en-US", async () => {
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrSlash({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
    });

    expect(result.reply).toBe(translate("vr.seasonLocked"));
    expect(result.action).toEqual({ type: "none" });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("returns localized seasonLocked copy for pt-BR", async () => {
    const translate = createDiscordTranslator("pt-BR");

    const result = await handleDiscordVrSlash({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "pt-BR",
    });

    expect(result.reply).toBe(translate("vr.seasonLocked"));
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });
});
