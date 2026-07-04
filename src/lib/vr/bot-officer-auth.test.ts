import { beforeEach, describe, expect, it, vi } from "vitest";

import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";

vi.mock("@/lib/vr/repository", () => ({
  callerIsAllianceOwner: vi.fn(),
  callerIsAllianceOfficerViaMemberLink: vi.fn(),
}));

import {
  callerIsAllianceOfficerViaMemberLink,
  callerIsAllianceOwner,
} from "@/lib/vr/repository";

const allianceId = "alliance-1";
const discordUserId = "discord-1";

describe("callerCanRunVrReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(false);
    vi.mocked(callerIsAllianceOfficerViaMemberLink).mockResolvedValue(false);
  });

  it("allows alliance owner", async () => {
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(true);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(true);
  });

  it("allows linked R4+ officer via member link gate", async () => {
    vi.mocked(callerIsAllianceOfficerViaMemberLink).mockResolvedValue(true);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(true);

    expect(callerIsAllianceOfficerViaMemberLink).toHaveBeenCalledWith({
      allianceId,
      discordUserId,
    });
  });

  it("denies when officer gate fails", async () => {
    vi.mocked(callerIsAllianceOfficerViaMemberLink).mockResolvedValue(false);

    await expect(
      callerCanRunVrReport({ allianceId, discordUserId }),
    ).resolves.toBe(false);
  });
});
