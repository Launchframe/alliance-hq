import { beforeEach, describe, expect, it, vi } from "vitest";

import * as sessionModule from "@/lib/session";
import { sessionHasLiveAshedVerification } from "@/lib/member-link/privileged-link.server";

import { getRbacContext, sessionHasPermission, sessionHasPermissionForAlliance } from "./context";

const selectMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
  }),
  schema: {
    hqUsers: { id: "hqUsers.id" },
    allianceMemberships: {
      hqUserId: "allianceMemberships.hqUserId",
      allianceId: "allianceMemberships.allianceId",
      status: "allianceMemberships.status",
      roleId: "allianceMemberships.roleId",
    },
    roles: { id: "roles.id", name: "roles.name" },
    rolePermissions: {
      roleId: "rolePermissions.roleId",
      permissionId: "rolePermissions.permissionId",
    },
  },
}));

vi.mock("@/lib/profile/resolve-avatar", () => ({
  ensureHqUserAvatarFresh: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/rbac/ashed-session-membership", () => ({
  sessionHoldsAshedIdentityForHqUser: vi.fn().mockResolvedValue(true),
  ashedSourcedMembershipIsActiveForSession: (
    source: string,
    holdsAshedIdentity: boolean,
  ) => source !== "ashed" || holdsAshedIdentity,
}));

vi.mock("@/lib/member-link/privileged-link.server", () => ({
  sessionHasLiveAshedVerification: vi.fn().mockResolvedValue(true),
}));

function chainSelectWithLimit(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

function chainSelectPermissions(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe("getRbacContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "magic-stub",
      allianceId: "a1",
      allianceTag: "LFgo",
      currentAllianceId: "a1",
      userLabel: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.spyOn(sessionModule, "resolveEffectiveHqUserIdForSession").mockResolvedValue(
      "canonical-user",
    );
  });

  it("loads permissions for the effective HQ user, not the magic-link stub", async () => {
    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "canonical-user",
            email: "player@example.com",
            displayName: "Player",
            isPlatformMaintainer: 0,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([{ isPlatformMaintainer: 0 }]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "officer", roleId: "role-officer", source: "ashed" },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectPermissions([{ permissionId: "members:read" }]),
      );

    const ctx = await getRbacContext("sess-1");

    expect(ctx?.hqUserId).toBe("canonical-user");
    expect(ctx?.roleName).toBe("officer");
    expect(sessionModule.resolveEffectiveHqUserIdForSession).toHaveBeenCalledWith(
      "sess-1",
      "magic-stub",
    );
  });

  it("grants manual officer permissions without live Ashed verification", async () => {
    vi.mocked(sessionHasLiveAshedVerification).mockResolvedValue(false);
    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "canonical-user",
            email: "officer@example.com",
            displayName: "Officer",
            isPlatformMaintainer: 0,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([{ isPlatformMaintainer: 0 }]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "officer", roleId: "role-officer", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectPermissions([{ permissionId: "trains:write" }]),
      );

    const ctx = await getRbacContext("sess-1");

    expect(ctx?.roleName).toBe("officer");
    expect(ctx?.permissions.has("trains:write")).toBe(true);
  });

  it("grants manual owner permissions without live Ashed verification", async () => {
    vi.mocked(sessionHasLiveAshedVerification).mockResolvedValue(false);
    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "canonical-user",
            email: "owner@example.com",
            displayName: "Owner",
            isPlatformMaintainer: 0,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([{ isPlatformMaintainer: 0 }]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "owner", roleId: "role-owner", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectPermissions([{ permissionId: "members:write" }]),
      );

    const ctx = await getRbacContext("sess-1");

    expect(ctx?.roleName).toBe("owner");
    expect(ctx?.permissions.has("members:write")).toBe(true);
  });

  it("grants hq:admin for platform maintainer without live Ashed verification", async () => {
    vi.mocked(sessionHasLiveAshedVerification).mockResolvedValue(false);
    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "canonical-user",
            email: "pm@example.com",
            displayName: "PM",
            isPlatformMaintainer: 1,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "member", roleId: "role-member", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(chainSelectPermissions([]));

    const ctx = await getRbacContext("sess-1");

    expect(ctx?.isPlatformMaintainer).toBe(true);
    expect(ctx?.permissions.has("hq:admin")).toBe(true);
  });

  it("grants hq:admin for platform maintainer with live Ashed verification", async () => {
    vi.mocked(sessionHasLiveAshedVerification).mockResolvedValue(true);
    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "canonical-user",
            email: "pm@example.com",
            displayName: "PM",
            isPlatformMaintainer: 1,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "member", roleId: "role-member", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(chainSelectPermissions([]));

    const ctx = await getRbacContext("sess-1");

    expect(ctx?.permissions.has("hq:admin")).toBe(true);
  });
});

describe("sessionHasPermission", () => {
  it("allows legacy sessions without hqUserId until reconnect", async () => {
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: null,
      allianceId: "a1",
      allianceTag: "LFgo",
      currentAllianceId: null,
      userLabel: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      sessionHasPermission("sess-1", "members:write"),
    ).resolves.toBe(true);
  });

  it("denies when permission is null", async () => {
    await expect(sessionHasPermission("sess-1", null)).resolves.toBe(false);
  });
});

describe("sessionHasPermissionForAlliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "pm-user",
      allianceId: "a1",
      allianceTag: "LFgo",
      currentAllianceId: "a1",
      userLabel: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.spyOn(sessionModule, "resolveEffectiveHqUserIdForSession").mockResolvedValue(
      "pm-user",
    );
  });

  it("allows platform maintainer without membership in target alliance", async () => {
    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "pm-user",
            email: "pm@example.com",
            displayName: "PM",
            isPlatformMaintainer: 1,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "member", roleId: "role-member", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(chainSelectPermissions([]));

    await expect(
      sessionHasPermissionForAlliance("sess-1", "other-alliance", "scores:read"),
    ).resolves.toBe(true);
  });

  it("checks alliance membership permissions for non-maintainers", async () => {
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "officer-user",
      allianceId: "a1",
      allianceTag: "LFgo",
      currentAllianceId: "a1",
      userLabel: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.spyOn(sessionModule, "resolveEffectiveHqUserIdForSession").mockResolvedValue(
      "officer-user",
    );

    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "officer-user",
            email: "officer@example.com",
            displayName: "Officer",
            isPlatformMaintainer: 0,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "officer", roleId: "role-officer", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectPermissions([{ permissionId: "scores:read" }]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "officer", roleId: "role-officer", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectPermissions([{ permissionId: "scores:read" }]),
      );

    await expect(
      sessionHasPermissionForAlliance("sess-1", "a1", "scores:read"),
    ).resolves.toBe(true);
  });

  it("denies non-maintainers without the requested alliance permission", async () => {
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "officer-user",
      allianceId: "a1",
      allianceTag: "LFgo",
      currentAllianceId: "a1",
      userLabel: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.spyOn(sessionModule, "resolveEffectiveHqUserIdForSession").mockResolvedValue(
      "officer-user",
    );

    selectMock
      .mockReturnValueOnce(
        chainSelectWithLimit([
          {
            id: "officer-user",
            email: "officer@example.com",
            displayName: "Officer",
            isPlatformMaintainer: 0,
          },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "officer", roleId: "role-officer", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(
        chainSelectPermissions([{ permissionId: "scores:read" }]),
      )
      .mockReturnValueOnce(
        chainSelectWithLimit([
          { roleName: "officer", roleId: "role-officer", source: "manual" },
        ]),
      )
      .mockReturnValueOnce(chainSelectPermissions([]));

    await expect(
      sessionHasPermissionForAlliance("sess-1", "a1", "alliance:admin"),
    ).resolves.toBe(false);
  });
});
