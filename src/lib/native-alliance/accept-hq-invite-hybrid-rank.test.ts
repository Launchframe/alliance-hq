import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDb,
  provisionAllianceMembership,
  getLinkedMemberIds,
  assertHybridClaimInviteRankAtAccept,
  auditInviteAccepted,
} = vi.hoisted(() => ({
  getDb: vi.fn(),
  provisionAllianceMembership: vi.fn(),
  getLinkedMemberIds: vi.fn(),
  assertHybridClaimInviteRankAtAccept: vi.fn(),
  auditInviteAccepted: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb,
  };
});

vi.mock("./provision-membership", () => ({
  provisionAllianceMembership,
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds,
}));

vi.mock("./invite-accept-rank.server", () => ({
  assertHybridClaimInviteRankAtAccept,
}));

vi.mock("@/lib/onboarding/onboarding-audit.server", () => ({
  auditInviteAccepted,
}));

import { ROLE_IDS } from "@/lib/rbac/constants";

import { acceptHqInvite } from "./invites";

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    allianceId: "alliance-1",
    kind: "email",
    email: "bob@example.com",
    roleId: ROLE_IDS.owner,
    tokenHash: "hash",
    passphraseHash: null,
    passphraseConsumedAt: null,
    targetAshedMemberId: "commander-r5",
    invitedByHqUserId: "officer-1",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    redirectPath: "/onboard",
    ...overrides,
  };
}

describe("acceptHqInvite hybrid rank gate wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLinkedMemberIds.mockResolvedValue(new Set());
    provisionAllianceMembership.mockResolvedValue({
      allianceId: "alliance-1",
      allianceTag: "TAG",
      allianceName: "Test",
      hqUserId: "bob",
      roleName: "owner",
    });
    auditInviteAccepted.mockResolvedValue(undefined);
    assertHybridClaimInviteRankAtAccept.mockResolvedValue(undefined);
  });

  it("calls rank gate before marking accepted / provisioning", async () => {
    const invite = inviteRow();
    const update = vi.fn();
    const callOrder: string[] = [];

    assertHybridClaimInviteRankAtAccept.mockImplementation(async () => {
      callOrder.push("rank_gate");
    });
    update.mockImplementation(() => {
      callOrder.push("accept_update");
      return {
        set: () => ({
          where: () => ({
            returning: async () => [{ id: "inv-1" }],
          }),
        }),
      };
    });
    provisionAllianceMembership.mockImplementation(async () => {
      callOrder.push("provision");
      return {
        allianceId: "alliance-1",
        allianceTag: "TAG",
        allianceName: "Test",
        hqUserId: "bob",
        roleName: "owner",
      };
    });

    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [invite],
          }),
        }),
      })),
      update,
      delete: vi.fn(() => ({
        where: async () => undefined,
      })),
    } as never);

    // hashInviteToken is internal — any token works with mocked select
    await acceptHqInvite({
      token: "any-token",
      sessionId: "sess-1",
      hqUserId: "bob",
      userEmail: "bob@example.com",
      email: "bob@example.com",
    });

    expect(assertHybridClaimInviteRankAtAccept).toHaveBeenCalledWith({
      allianceId: "alliance-1",
      roleId: ROLE_IDS.owner,
      targetAshedMemberId: "commander-r5",
      invitedByHqUserId: "officer-1",
    });
    expect(callOrder).toEqual(["rank_gate", "accept_update", "provision"]);
  });

  it("does not provision when hybrid rank gate rejects", async () => {
    const invite = inviteRow();
    const update = vi.fn();

    assertHybridClaimInviteRankAtAccept.mockRejectedValue(
      new Error(
        "Owner invite requires the claim commander to still be in-game R5.",
      ),
    );

    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [invite],
          }),
        }),
      })),
      update,
      delete: vi.fn(),
    } as never);

    await expect(
      acceptHqInvite({
        token: "any-token",
        sessionId: "sess-1",
        hqUserId: "bob",
        userEmail: "bob@example.com",
        email: "bob@example.com",
      }),
    ).rejects.toThrow(/still be in-game R5/);

    expect(update).not.toHaveBeenCalled();
    expect(provisionAllianceMembership).not.toHaveBeenCalled();
  });
});
