import { beforeEach, describe, expect, it, vi } from "vitest";

import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";

vi.mock("@/lib/vr/repository", () => ({
  callerIsAllianceOwner: vi.fn(),
  listDiscordLinksForUser: vi.fn(),
}));

vi.mock("@/lib/vr/member-roster", () => ({
  loadAllianceMembersForBot: vi.fn(),
}));

import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  callerIsAllianceOwner,
  listDiscordLinksForUser,
} from "@/lib/vr/repository";

const allianceId = "alliance-1";
const discordUserId = "discord-1";

describe("callerCanRunVrReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(false);
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([]);
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([]);
  });

  it("allows alliance owner", async () => {
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(true);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(true);
  });

  it("allows linked R4 member", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      { ashedMemberId: "m-officer" } as never,
    ]);
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([
      { id: "m-officer", current_name: "Officer", alliance_rank: 4 } as never,
    ]);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(true);
  });

  it("allows linked officer title rank from roster string", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      { ashedMemberId: "m-warlord" } as never,
    ]);
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([
      { id: "m-warlord", current_name: "Warlord", rank: "Warlord" } as never,
    ]);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(true);
  });

  it("allows linked R5 leader", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      { ashedMemberId: "m-leader" } as never,
    ]);
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([
      { id: "m-leader", current_name: "Leader", rank: "Leader" } as never,
    ]);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(true);
  });

  it("denies linked R3 member", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      { ashedMemberId: "m-member" } as never,
    ]);
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([
      { id: "m-member", current_name: "Member", alliance_rank: 3 } as never,
    ]);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(false);
  });

  it("allows linked R4 from local roster without checking alliance credentials", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      { ashedMemberId: "m-officer" } as never,
    ]);
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([
      { id: "m-officer", current_name: "Officer", alliance_rank: 4 } as never,
    ]);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(true);
  });
});
