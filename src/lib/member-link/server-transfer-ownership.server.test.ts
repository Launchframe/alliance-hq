import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  resolveAllianceGameServerNumber,
  resolveCommanderByUid,
  isInviteGatedMemberLink,
  isGameUidClaimedByOtherPrincipal,
} = vi.hoisted(() => ({
  resolveAllianceGameServerNumber: vi.fn(),
  resolveCommanderByUid: vi.fn(),
  isInviteGatedMemberLink: vi.fn(),
  isGameUidClaimedByOtherPrincipal: vi.fn(),
}));

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber,
}));

vi.mock("@/lib/members/commander-identity.server", () => ({
  resolveCommanderByUid,
}));

vi.mock("@/lib/member-link/invite-gate.server", () => ({
  isInviteGatedMemberLink,
}));

vi.mock("@/lib/member-link/game-uid-global-claim.server", () => ({
  isGameUidClaimedByOtherPrincipal,
}));

import { resolveMemberLinkServerEligibilityForUid } from "./server-eligibility.server";

describe("server transfer ownership gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllianceGameServerNumber.mockResolvedValue(1249);
    resolveCommanderByUid.mockResolvedValue({
      id: "cmd-1",
      gameServerNumber: 1211,
    });
    isInviteGatedMemberLink.mockResolvedValue({ gated: true, inviteId: "inv" });
  });

  it("rejects transfer confirmation when another HQ account already owns the UID", async () => {
    isGameUidClaimedByOtherPrincipal.mockResolvedValue(true);

    const result = await resolveMemberLinkServerEligibilityForUid({
      allianceId: "a-dest",
      gameUid: "1001369694001249",
      lookupServer: 1249,
      hqUserId: "hq-bob",
    });

    expect(result.kind).toBe("rejected");
    expect(result).toMatchObject({ reason: "known_home_mismatch" });
    expect(isGameUidClaimedByOtherPrincipal).toHaveBeenCalledWith({
      gameUid: "1001369694001249",
      hqUserId: "hq-bob",
      discordUserId: undefined,
    });
  });

  it("allows transfer confirmation for the owning HQ account", async () => {
    isGameUidClaimedByOtherPrincipal.mockResolvedValue(false);

    const result = await resolveMemberLinkServerEligibilityForUid({
      allianceId: "a-dest",
      gameUid: "1001369694001249",
      lookupServer: 1249,
      hqUserId: "hq-alice",
      allianceHomeConfirmed: true,
    });

    expect(result).toMatchObject({
      kind: "eligible",
      reason: "user_confirmed_server_transfer",
    });
  });
});
