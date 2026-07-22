import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/vr/repository", () => ({
  getAllianceTrainChannelSetterMinRank: vi.fn(),
  callerIsAllianceOwner: vi.fn(),
  callerIsAllianceOfficerViaMemberLink: vi.fn(),
}));

import { resolveDiscordChannelSetterAccess } from "@/lib/discord/channel-setter-auth.server";
import {
  callerIsAllianceOfficerViaMemberLink,
  callerIsAllianceOwner,
  getAllianceTrainChannelSetterMinRank,
} from "@/lib/vr/repository";

describe("resolveDiscordChannelSetterAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows linked R4+ officers when min rank is officer", async () => {
    vi.mocked(getAllianceTrainChannelSetterMinRank).mockResolvedValue("officer");
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(false);
    vi.mocked(callerIsAllianceOfficerViaMemberLink).mockResolvedValue(true);

    await expect(
      resolveDiscordChannelSetterAccess({
        allianceId: "a1",
        discordUserId: "d1",
      }),
    ).resolves.toEqual({ allowed: true, minRank: "officer" });
  });

  it("denies R4+ officers when min rank is owner-only", async () => {
    vi.mocked(getAllianceTrainChannelSetterMinRank).mockResolvedValue("owner");
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(false);
    vi.mocked(callerIsAllianceOfficerViaMemberLink).mockResolvedValue(true);

    await expect(
      resolveDiscordChannelSetterAccess({
        allianceId: "a1",
        discordUserId: "d1",
      }),
    ).resolves.toEqual({
      allowed: false,
      minRank: "owner",
      denialKey: "channelSetter.deniedOwnerOnly",
    });
  });

  it("denies non-officers with the officer denial key when R4+ is allowed", async () => {
    vi.mocked(getAllianceTrainChannelSetterMinRank).mockResolvedValue("officer");
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(false);
    vi.mocked(callerIsAllianceOfficerViaMemberLink).mockResolvedValue(false);

    await expect(
      resolveDiscordChannelSetterAccess({
        allianceId: "a1",
        discordUserId: "d1",
      }),
    ).resolves.toEqual({
      allowed: false,
      minRank: "officer",
      denialKey: "channelSetter.deniedOfficer",
    });
  });
});
