import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleDiscordWhatIsMyThp,
  handleDiscordWhatIsMyVr,
} from "@/lib/vr/bot-status-query";

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  ensureDiscordMemberLinksFromHq: vi.fn(),
}));

vi.mock("@/lib/thp/repository", () => ({
  getCommanderIdForMember: vi.fn(),
  getCommanderThpState: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getCommanderByAshedMemberId: vi.fn(),
  getMemberSeasonHigh: vi.fn(),
  listDiscordLinksForUser: vi.fn(),
  resolveSeasonKey: vi.fn(),
  writeDiscordBotAudit: vi.fn(),
}));

import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import {
  getCommanderIdForMember,
  getCommanderThpState,
} from "@/lib/thp/repository";
import {
  getCommanderByAshedMemberId,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  resolveSeasonKey,
} from "@/lib/vr/repository";

const link = {
  id: "link-1",
  allianceId: "a1",
  discordUserId: "d1",
  discordUsername: "player",
  ashedMemberId: "m1",
  memberDisplayName: "Alpha",
  gameUid: "123",
  linkedAt: new Date(),
  updatedAt: new Date(),
};

describe("handleDiscordWhatIsMyVr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSeasonKey).mockResolvedValue("1");
    vi.mocked(ensureDiscordMemberLinksFromHq).mockResolvedValue({
      inherited: 0,
      skipped: 0,
    });
  });

  it("prompts to link when no commanders are linked", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([]);
    const result = await handleDiscordWhatIsMyVr({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.reply).toMatch(/link-commander/i);
  });

  it("reports institute level and effective VR", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link]);
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(1000);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      weeklyPassActive: false,
    } as never);

    const result = await handleDiscordWhatIsMyVr({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.reply).toMatch(/Alpha/);
    expect(result.reply).toMatch(/1000/);
  });
});

describe("handleDiscordWhatIsMyThp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureDiscordMemberLinksFromHq).mockResolvedValue({
      inherited: 0,
      skipped: 0,
    });
  });

  it("prompts to link when no commanders are linked", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([]);
    const result = await handleDiscordWhatIsMyThp({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.reply).toMatch(/link-commander/i);
  });

  it("reports current total hero power", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link]);
    vi.mocked(getCommanderIdForMember).mockResolvedValue("cmd-1");
    vi.mocked(getCommanderThpState).mockResolvedValue({
      currentTotalHeroPower: 163_460_435,
      currentThpBreakdown: null,
      thpUpdatedAt: new Date(),
      primaryName: "Alpha",
    });

    const result = await handleDiscordWhatIsMyThp({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.reply).toMatch(/Alpha/);
    expect(result.reply).toMatch(/163/);
  });
});
