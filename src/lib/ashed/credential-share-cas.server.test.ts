import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
    update: updateMock,
  }),
  schema: {
    ashedCredentialShares: {
      id: "ashedCredentialShares.id",
      allianceId: "ashedCredentialShares.allianceId",
      ownerHqUserId: "ashedCredentialShares.ownerHqUserId",
      delegateHqUserId: "ashedCredentialShares.delegateHqUserId",
      invitedHqUserId: "ashedCredentialShares.invitedHqUserId",
      status: "ashedCredentialShares.status",
      capabilities: "ashedCredentialShares.capabilities",
      encryptedToken: "ashedCredentialShares.encryptedToken",
      acceptedAt: "ashedCredentialShares.acceptedAt",
      rejectedAt: "ashedCredentialShares.rejectedAt",
      revokedAt: "ashedCredentialShares.revokedAt",
      endReason: "ashedCredentialShares.endReason",
      updatedAt: "ashedCredentialShares.updatedAt",
    },
    allianceMemberships: {
      allianceId: "allianceMemberships.allianceId",
      hqUserId: "allianceMemberships.hqUserId",
      status: "allianceMemberships.status",
      roleId: "allianceMemberships.roleId",
    },
    roles: {
      id: "roles.id",
    },
    hqUsers: {
      id: "hqUsers.id",
      email: "hqUsers.email",
      displayName: "hqUsers.displayName",
    },
  },
}));

vi.mock("@/lib/session", () => ({
  loadSession: vi.fn(async () => ({ hqUserId: "delegate-1" })),
  resolveEffectiveHqUserIdForSession: vi.fn(async () => "delegate-1"),
  getAshedCredentialRecord: vi.fn(),
}));

vi.mock("@/lib/rbac/ashed-session-membership", () => ({
  sessionHoldsAshedIdentityForHqUser: vi.fn(async () => false),
}));

vi.mock("@/lib/ashed/credential-share-audit.server", () => ({
  writeCredentialShareAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ashed/credential-share-email.server", () => ({
  sendCredentialShareAcceptedEmail: vi.fn(async () => undefined),
  sendCredentialShareRejectedEmail: vi.fn(async () => undefined),
  sendCredentialShareRevokedEmail: vi.fn(async () => undefined),
  sendCredentialShareExpiredEmails: vi.fn(async () => undefined),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

import {
  acceptCredentialShare,
  revokeCredentialShare,
} from "@/lib/ashed/credential-share.server";

/** Drizzle-style thenable that resolves when awaited as an array. */
function selectRows(rows: unknown[]) {
  const terminal = {
    limit: vi.fn().mockResolvedValue(rows),
    then: undefined as unknown,
  };
  // Support both `.where().limit()` and awaitable where chains.
  const where = vi.fn().mockReturnValue(terminal);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return {
    from: vi.fn().mockReturnValue({ where, innerJoin }),
  };
}

function updateReturning(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set, where, returning };
}

describe("credential share status CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accept refuses when a concurrent revoke already ended the pending invite", async () => {
    selectMock
      // Load invite
      .mockReturnValueOnce(
        selectRows([
          {
            id: "share-1",
            allianceId: "alliance-1",
            ownerHqUserId: "owner-1",
            invitedHqUserId: "delegate-1",
            delegateHqUserId: null,
            status: "pending",
            capabilities: ["roster:read"],
            encryptedToken: "enc",
            expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          },
        ]),
      )
      // Officer membership check
      .mockReturnValueOnce(selectRows([{ roleId: "officer" }]))
      // Existing active-delegate conflict check
      .mockReturnValueOnce(selectRows([]));

    updateMock.mockReturnValueOnce(updateReturning([]));

    await expect(
      acceptCredentialShare({
        shareId: "share-1",
        targetSessionId: "session-1",
        acknowledged: true,
      }),
    ).rejects.toMatchObject({
      name: "CredentialShareError",
      code: "NOT_FOUND",
    });
  });

  it("revoke clears the encrypted token under a live-status CAS", async () => {
    selectMock.mockReturnValueOnce(
      selectRows([
        {
          id: "share-1",
          allianceId: "alliance-1",
          ownerHqUserId: "owner-1",
          invitedHqUserId: "delegate-1",
          delegateHqUserId: "delegate-1",
          status: "active",
          capabilities: ["roster:read"],
          encryptedToken: "enc",
        },
      ]),
    );

    const chain = updateReturning([{ id: "share-1" }]);
    updateMock.mockReturnValueOnce(chain);

    await revokeCredentialShare({
      shareId: "share-1",
      sessionId: "session-1",
      hqUserId: "owner-1",
    });

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "revoked",
        encryptedToken: null,
      }),
    );
  });
});
