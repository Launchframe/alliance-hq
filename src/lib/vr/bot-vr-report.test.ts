import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleDiscordVrReport } from "@/lib/vr/bot-vr-report";

vi.mock("@/lib/vr/bot-officer-auth", () => ({
  callerCanRunVrReport: vi.fn(),
}));

vi.mock("@/lib/vr/leaderboard.server", () => ({
  loadAllianceLeaderboard: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  writeDiscordBotAudit: vi.fn(),
}));

import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import { loadAllianceLeaderboard } from "@/lib/vr/leaderboard.server";

describe("handleDiscordVrReport", () => {
  beforeEach(() => {
    vi.mocked(callerCanRunVrReport).mockResolvedValue(true);
    vi.mocked(loadAllianceLeaderboard).mockResolvedValue({
      seasonKey: "1",
      allianceTag: "LFgo",
      rows: [],
    });
  });

  it("requires teams option for takedown-teams command", async () => {
    const result = await handleDiscordVrReport({
      allianceId: "a1",
      discordUserId: "d1",
      commandName: "takedown-teams",
      locale: "en-US",
    });
    expect(result.reply).toMatch(/teams:N/i);
    expect(callerCanRunVrReport).not.toHaveBeenCalled();
  });
});
