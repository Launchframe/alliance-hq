import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  session: {
    id: "session-1",
    allianceId: "alliance-a",
    currentAllianceId: "alliance-a",
    hqUserId: "user-1",
  },
  permissionAllowed: true,
  alliancePermissionAllowed: true,
  memberRow: {
    id: "row-1",
    allianceId: "alliance-a",
    ashedMemberId: "member-1",
    currentName: "Alice",
  } as Record<string, unknown> | null,
};

vi.mock("@/lib/session", () => ({
  loadSession: async () => mockState.session,
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: async () =>
    mockState.permissionAllowed ? null : new Response(null, { status: 403 }),
}));

vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermissionForAlliance: async () => mockState.alliancePermissionAllowed,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mockState.memberRow ? [mockState.memberRow] : []),
        }),
      }),
    }),
  }),
  schema: {
    allianceMembers: {
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
    },
  },
}));

import {
  assertCommanderReadAccess,
  loadAllianceCommander,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";

describe("commander-access.server", () => {
  beforeEach(() => {
    mockState.permissionAllowed = true;
    mockState.alliancePermissionAllowed = true;
    mockState.memberRow = {
      id: "row-1",
      allianceId: "alliance-a",
      ashedMemberId: "member-1",
      currentName: "Alice",
    };
  });

  it("resolves session alliance context", async () => {
    const ctx = await resolveCommanderSessionContext("session-1");
    expect(ctx.allianceId).toBe("alliance-a");
  });

  it("denies when alliance permission fails", async () => {
    mockState.alliancePermissionAllowed = false;
    await expect(
      assertCommanderReadAccess("session-1", "alliance-a"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("loads commander within alliance scope", async () => {
    const row = await loadAllianceCommander("alliance-a", "member-1");
    expect(row?.currentName).toBe("Alice");
  });
});
