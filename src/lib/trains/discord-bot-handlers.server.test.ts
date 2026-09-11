import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callerCanManageTrains: vi.fn(),
  loadAllianceMembersForBot: vi.fn(),
  draftConductorForAlliance: vi.fn(),
  resolveDiscordHqUserId: vi.fn(),
  writeDiscordBotAudit: vi.fn(),
}));

vi.mock("@/lib/trains/discord-bot-auth.server", () => ({
  callerCanManageTrains: mocks.callerCanManageTrains,
}));

vi.mock("@/lib/vr/member-roster", () => ({
  loadAllianceMembersForBot: mocks.loadAllianceMembersForBot,
}));

vi.mock("@/lib/trains/discord-bot.server", () => ({
  draftConductorForAlliance: mocks.draftConductorForAlliance,
  lockTrainAndAnnounce: vi.fn(),
}));

vi.mock("@/lib/trains/train-ownership.server", () => ({
  resolveDiscordHqUserId: mocks.resolveDiscordHqUserId,
}));

vi.mock("@/lib/vr/repository", () => ({
  writeDiscordBotAudit: mocks.writeDiscordBotAudit,
  getAllianceById: vi.fn(),
  getGuildAllianceId: vi.fn(),
  setGuildTrainChannel: vi.fn(),
}));

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn(),
}));

import { handleDiscordTrainConductorPick } from "@/lib/trains/discord-bot-handlers.server";
import { ManualPickEligibilityError } from "@/lib/trains/depleting-manual-pick.shared";

describe("handleDiscordTrainConductorPick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callerCanManageTrains.mockResolvedValue(true);
    mocks.resolveDiscordHqUserId.mockResolvedValue("hq-officer");
    mocks.writeDiscordBotAudit.mockResolvedValue(undefined);
    mocks.loadAllianceMembersForBot.mockResolvedValue([
      { id: "m-alice", current_name: "Alice" },
    ]);
  });

  it("asks for a second Yes when the first identity confirm would override eligibility", async () => {
    mocks.draftConductorForAlliance.mockRejectedValue(
      new ManualPickEligibilityError(
        "already_awarded",
        "This member was already selected from the current pool generation.",
      ),
    );

    const result = await handleDiscordTrainConductorPick({
      allianceId: "ally-1",
      discordUserId: "discord-1",
      locale: "en-US",
      memberId: "m-alice",
      date: "2026-07-27",
    });

    expect(mocks.draftConductorForAlliance).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEligibilityOverride: false,
        memberId: "m-alice",
      }),
    );
    expect(result.pendingEligibilityOverride).toEqual({
      memberId: "m-alice",
      memberName: "Alice",
      date: "2026-07-27",
      reason: "already_awarded",
    });
    expect(result.reply).toMatch(/already conducted/i);
  });

  it("assigns after the officer confirms the eligibility override", async () => {
    mocks.draftConductorForAlliance.mockResolvedValue({ id: "rec-1" });

    const result = await handleDiscordTrainConductorPick({
      allianceId: "ally-1",
      discordUserId: "discord-1",
      locale: "en-US",
      memberId: "m-alice",
      date: "2026-07-27",
      allowEligibilityOverride: true,
    });

    expect(mocks.draftConductorForAlliance).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEligibilityOverride: true,
        memberId: "m-alice",
      }),
    );
    expect(result.pendingEligibilityOverride).toBeUndefined();
    expect(result.reply).toMatch(/Alice/);
  });
});
