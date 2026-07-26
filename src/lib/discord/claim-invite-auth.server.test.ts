import { beforeEach, describe, expect, it, vi } from "vitest";

import { callerCanIssueClaimInviteFromDiscord } from "@/lib/discord/claim-invite-auth.server";

vi.mock("@/lib/vr/bot-officer-auth", () => ({
  callerCanRunVrReport: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  callerIsAllianceOwner: vi.fn(),
  callerIsPlatformMaintainerViaDiscord: vi.fn(),
  getAllianceById: vi.fn(),
}));

import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import {
  callerIsAllianceOwner,
  callerIsPlatformMaintainerViaDiscord,
  getAllianceById,
} from "@/lib/vr/repository";

describe("callerCanIssueClaimInviteFromDiscord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callerIsPlatformMaintainerViaDiscord).mockResolvedValue(false);
    vi.mocked(getAllianceById).mockResolvedValue({
      inviteOnboardingMinRole: "officer",
    } as never);
  });

  it("returns false when the alliance is missing", async () => {
    vi.mocked(getAllianceById).mockResolvedValue(null as never);
    await expect(
      callerCanIssueClaimInviteFromDiscord({
        allianceId: "a1",
        discordUserId: "d1",
      }),
    ).resolves.toBe(false);
  });

  it("allows platform maintainers without owner/officer proof", async () => {
    vi.mocked(callerIsPlatformMaintainerViaDiscord).mockResolvedValue(true);
    vi.mocked(getAllianceById).mockResolvedValue({
      inviteOnboardingMinRole: "owner",
    } as never);

    await expect(
      callerCanIssueClaimInviteFromDiscord({
        allianceId: "a1",
        discordUserId: "d1",
      }),
    ).resolves.toBe(true);
    expect(getAllianceById).not.toHaveBeenCalled();
    expect(callerIsAllianceOwner).not.toHaveBeenCalled();
    expect(callerCanRunVrReport).not.toHaveBeenCalled();
  });

  it("requires owner proof when invite onboarding is owner-only", async () => {
    vi.mocked(getAllianceById).mockResolvedValue({
      inviteOnboardingMinRole: "owner",
    } as never);
    vi.mocked(callerIsAllianceOwner).mockResolvedValue(true);
    vi.mocked(callerCanRunVrReport).mockResolvedValue(false);

    await expect(
      callerCanIssueClaimInviteFromDiscord({
        allianceId: "a1",
        discordUserId: "d1",
      }),
    ).resolves.toBe(true);
    expect(callerIsAllianceOwner).toHaveBeenCalled();
    expect(callerCanRunVrReport).not.toHaveBeenCalled();
  });

  it("uses officer gate when invite onboarding allows officers", async () => {
    vi.mocked(callerCanRunVrReport).mockResolvedValue(true);

    await expect(
      callerCanIssueClaimInviteFromDiscord({
        allianceId: "a1",
        discordUserId: "d1",
      }),
    ).resolves.toBe(true);
    expect(callerCanRunVrReport).toHaveBeenCalled();
  });
});
