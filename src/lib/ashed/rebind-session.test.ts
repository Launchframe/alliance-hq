import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rebindAshedIdentityToSession,
  revokeAshedMembershipsForHqUser,
} from "@/lib/ashed/rebind-session";

const writeAuditLogMock = vi.fn();

const selectMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLogMock(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
    update: updateMock,
    delete: deleteMock,
  }),
  schema: {
    allianceMemberships: {
      id: "allianceMemberships.id",
      hqUserId: "allianceMemberships.hqUserId",
      allianceId: "allianceMemberships.allianceId",
      source: "allianceMemberships.source",
      status: "allianceMemberships.status",
    },
    ashedCredentials: {
      id: "ashedCredentials.id",
      sessionId: "ashedCredentials.sessionId",
      ashedUserId: "ashedCredentials.ashedUserId",
    },
    sessions: {
      id: "sessions.id",
    },
  },
}));

function chainSelect(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function chainUpdate() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function chainDelete() {
  return {
    where: vi.fn().mockResolvedValue(undefined),
  };
}

describe("revokeAshedMembershipsForHqUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue(chainUpdate());
  });

  it("revokes active ashed-sourced memberships for the HQ user", async () => {
    selectMock.mockReturnValueOnce(
      chainSelect([{ id: "membership-1" }, { id: "membership-2" }]),
    );

    const count = await revokeAshedMembershipsForHqUser("orphan-user", "alliance-1");

    expect(count).toBe(2);
    expect(updateMock).toHaveBeenCalledTimes(2);
  });
});

describe("rebindAshedIdentityToSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue(chainUpdate());
    deleteMock.mockReturnValue(chainDelete());
    writeAuditLogMock.mockResolvedValue(undefined);
  });

  it("removes duplicate Ashed credentials, clears other sessions, and revokes orphan memberships", async () => {
    selectMock
      .mockReturnValueOnce(
        chainSelect([
          { id: "cred-a", sessionId: "session-a" },
          { id: "cred-b", sessionId: "session-b" },
        ]),
      )
      .mockReturnValueOnce(
        chainSelect([{ id: "membership-orphan" }]),
      );

    const result = await rebindAshedIdentityToSession({
      ashedUserId: "ashed-shared",
      canonicalHqUserId: "canonical-user",
      sessionId: "session-winner",
      mergedFromHqUserId: "orphan-user",
      allianceId: "alliance-1",
    });

    expect(result).toEqual({
      revokedCredentialSessions: 2,
      revokedMemberships: 1,
    });
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalled();
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ashed.rebind",
        resourceType: "ashed_identity",
        resourceId: "ashed-shared",
        hqUserId: "canonical-user",
        metadata: expect.objectContaining({
          revokedCredentialSessions: 2,
          revokedMemberships: 1,
          mergedFromHqUserId: "orphan-user",
        }),
      }),
    );
  });

  it("skips orphan membership cleanup when merge source equals canonical user", async () => {
    selectMock.mockReturnValueOnce(chainSelect([]));

    const result = await rebindAshedIdentityToSession({
      ashedUserId: "ashed-shared",
      canonicalHqUserId: "canonical-user",
      sessionId: "session-winner",
      mergedFromHqUserId: "canonical-user",
      allianceId: "alliance-1",
    });

    expect(result).toEqual({
      revokedCredentialSessions: 0,
      revokedMemberships: 0,
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
