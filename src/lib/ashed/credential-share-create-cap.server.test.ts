import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const insertMock = vi.fn();
const executeMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
    insert: insertMock,
    transaction: transactionMock,
  }),
  schema: {
    ashedCredentialShares: {
      id: "ashedCredentialShares.id",
      allianceId: "ashedCredentialShares.allianceId",
      ownerHqUserId: "ashedCredentialShares.ownerHqUserId",
      invitedHqUserId: "ashedCredentialShares.invitedHqUserId",
      status: "ashedCredentialShares.status",
      capabilities: "ashedCredentialShares.capabilities",
      encryptedToken: "ashedCredentialShares.encryptedToken",
      appId: "ashedCredentialShares.appId",
      originUrl: "ashedCredentialShares.originUrl",
      tokenExpiresAt: "ashedCredentialShares.tokenExpiresAt",
      ashedUserId: "ashedCredentialShares.ashedUserId",
      expiresAt: "ashedCredentialShares.expiresAt",
      inviteTokenHash: "ashedCredentialShares.inviteTokenHash",
      createdAt: "ashedCredentialShares.createdAt",
      updatedAt: "ashedCredentialShares.updatedAt",
      delegateHqUserId: "ashedCredentialShares.delegateHqUserId",
      acceptedAt: "ashedCredentialShares.acceptedAt",
      rejectedAt: "ashedCredentialShares.rejectedAt",
      revokedAt: "ashedCredentialShares.revokedAt",
      endReason: "ashedCredentialShares.endReason",
      lastAccessedAt: "ashedCredentialShares.lastAccessedAt",
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
  loadSession: vi.fn(async () => ({
    hqUserId: "owner-1",
    currentAllianceId: "alliance-1",
  })),
  resolveEffectiveHqUserIdForSession: vi.fn(async () => "owner-1"),
  getAshedCredentialRecord: vi.fn(async () => ({
    encryptedToken: "enc",
    appId: "app",
    originUrl: "https://example.test",
    tokenExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    ashedUserId: "ashed-owner",
  })),
}));

vi.mock("@/lib/rbac/ashed-session-membership", () => ({
  sessionHoldsAshedIdentityForHqUser: vi.fn(async () => true),
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
  createCredentialShareInvite,
  MAX_ACTIVE_CREDENTIAL_SHARES,
} from "@/lib/ashed/credential-share.server";

function selectRows(rows: unknown[]) {
  const terminal = {
    limit: vi.fn().mockResolvedValue(rows),
    then: undefined as unknown,
  };
  terminal.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  const where = vi.fn().mockReturnValue(terminal);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return {
    from: vi.fn().mockReturnValue({ where, innerJoin }),
  };
}

function shareRow() {
  return {
    id: "share-1",
    allianceId: "alliance-1",
    ownerHqUserId: "owner-1",
    invitedHqUserId: "invitee-1",
    delegateHqUserId: null,
    status: "pending",
    capabilities: ["roster:sync"],
    expiresAt: new Date("2026-10-12T00:00:00.000Z"),
    lastAccessedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    revokedAt: null,
    endReason: null,
    createdAt: new Date("2026-10-11T00:00:00.000Z"),
    updatedAt: new Date("2026-10-11T00:00:00.000Z"),
  };
}

describe("createCredentialShareInvite share cap", () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
    executeMock.mockReset();
    transactionMock.mockReset();

    selectMock
      // Officer membership check (outside tx)
      .mockReturnValueOnce(selectRows([{ roleId: "role-officer" }]))
      // Post-insert share row
      .mockReturnValueOnce(selectRows([shareRow()]))
      // User map
      .mockReturnValueOnce(
        selectRows([
          { id: "owner-1", email: "owner@example.com", displayName: "Owner" },
          {
            id: "invitee-1",
            email: "invitee@example.com",
            displayName: "Invitee",
          },
        ]),
      );
  });

  it("counts under an advisory lock before inserting", async () => {
    let countCalls = 0;
    transactionMock.mockImplementation(async (work) => {
      const tx = {
        execute: executeMock.mockResolvedValue(undefined),
        select: vi.fn(() => {
          countCalls += 1;
          const terminal = {
            then: (
              resolve: (value: unknown) => unknown,
              reject?: (reason: unknown) => unknown,
            ) =>
              Promise.resolve([{ value: MAX_ACTIVE_CREDENTIAL_SHARES - 1 }]).then(
                resolve,
                reject,
              ),
          };
          return {
            from: () => ({
              where: () => terminal,
            }),
          };
        }),
        insert: vi.fn(() => ({
          values: vi.fn().mockResolvedValue(undefined),
        })),
      };
      return work(tx);
    });

    const result = await createCredentialShareInvite({
      sessionId: "session-1",
      allianceId: "alliance-1",
      invitedHqUserId: "invitee-1",
      capabilities: ["roster:sync"],
      ttlHours: 24,
    });

    expect(result.share.id).toBe("share-1");
    expect(executeMock).toHaveBeenCalledTimes(1);
    const lockSql = executeMock.mock.calls[0]?.[0] as {
      queryChunks?: unknown[];
    };
    const lockText = JSON.stringify(lockSql?.queryChunks ?? []);
    expect(lockText).toContain("pg_advisory_xact_lock");
    expect(lockText).toContain("ashed-share-cap:alliance-1:owner-1");
    expect(countCalls).toBe(1);
  });

  it("rejects when the locked recount is already at the cap", async () => {
    transactionMock.mockImplementation(async (work) => {
      const tx = {
        execute: executeMock.mockResolvedValue(undefined),
        select: vi.fn(() => {
          const terminal = {
            then: (
              resolve: (value: unknown) => unknown,
              reject?: (reason: unknown) => unknown,
            ) =>
              Promise.resolve([{ value: MAX_ACTIVE_CREDENTIAL_SHARES }]).then(
                resolve,
                reject,
              ),
          };
          return {
            from: () => ({
              where: () => terminal,
            }),
          };
        }),
        insert: vi.fn(() => ({
          values: vi.fn().mockResolvedValue(undefined),
        })),
      };
      return work(tx);
    });

    await expect(
      createCredentialShareInvite({
        sessionId: "session-1",
        allianceId: "alliance-1",
        invitedHqUserId: "invitee-1",
        capabilities: ["roster:sync"],
        ttlHours: 24,
      }),
    ).rejects.toMatchObject({
      name: "CredentialShareError",
      code: "CONFLICT",
    });

    expect(executeMock).toHaveBeenCalled();
  });
});
