import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/admin-alerts", () => ({
  emitMemberLinkClaimConflictAlert: vi.fn().mockResolvedValue(undefined),
  emitMemberLinkUidTakenAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/member-link-help-queue.server", () => ({
  recordMemberLinkHelpRequest: vi.fn().mockResolvedValue("help-1"),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  loadGameUidClaimsForAlliance: vi.fn(),
}));

import {
  emitMemberLinkClaimConflictAlert,
  emitMemberLinkUidTakenAlert,
} from "@/lib/events/admin-alerts";
import { recordMemberLinkHelpRequest } from "@/lib/member-link/member-link-help-queue.server";
import { surfaceWebMemberLinkTakenConflict } from "@/lib/member-link/member-taken-conflict.server";
import { loadGameUidClaimsForAlliance } from "@/lib/member-link/repository.server";

describe("surfaceWebMemberLinkTakenConflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes discord-only UID claims to officer help with discord /link guidance", async () => {
    vi.mocked(loadGameUidClaimsForAlliance).mockResolvedValue({
      hqClaims: [],
      discordClaims: [
        {
          discordUserId: "discord-1",
          hqUserId: null,
          ashedMemberId: "member-old",
        },
      ],
    });

    const result = await surfaceWebMemberLinkTakenConflict({
      allianceId: "a1",
      allianceTag: "TST",
      hqUserId: "hq-new",
      handle: "player@example.com",
      locale: "en-US",
      gameUid: "1234567890121203",
      ashedMemberId: "member-old",
      gameUserName: "Commander Alpha",
      reportedName: "Commander Alpha",
    });

    expect(result.outcome).toBe("officer_notified");
    expect(result.message).toContain("/link");
    expect(emitMemberLinkUidTakenAlert).toHaveBeenCalled();
    expect(emitMemberLinkClaimConflictAlert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "discord_hq_unlinked" }),
    );
    expect(recordMemberLinkHelpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "cross_layer_claim",
        claimConflictReason: "discord_hq_unlinked",
      }),
    );
  });

  it("escalates HQ-owned UID conflicts to officers and maintainers", async () => {
    vi.mocked(loadGameUidClaimsForAlliance).mockResolvedValue({
      hqClaims: [{ hqUserId: "hq-existing", ashedMemberId: "member-old" }],
      discordClaims: [],
    });

    const result = await surfaceWebMemberLinkTakenConflict({
      allianceId: "a1",
      allianceTag: "TST",
      hqUserId: "hq-new",
      handle: "player@example.com",
      locale: "en-US",
      gameUid: "1234567890121203",
      ashedMemberId: "member-old",
      gameUserName: "Commander Alpha",
    });

    expect(result.outcome).toBe("member_taken");
    expect(result.message).toContain("notified");
    expect(recordMemberLinkHelpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "claim_conflict",
        claimConflictReason: "commander_taken",
      }),
    );
  });
});
