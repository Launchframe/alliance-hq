import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RbacContext } from "@/lib/rbac/context";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select }),
  schema: {
    allianceMembers: {
      allianceId: "alliance_id",
      ashedMemberId: "ashed_member_id",
      allianceRank: "alliance_rank",
      status: "status",
    },
    alliances: {
      id: "id",
      ownerHqUserId: "owner_hq_user_id",
      inviteOnboardingMinRole: "invite_onboarding_min_role",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: vi.fn(),
  sessionHasMembershipForAlliance: vi.fn(),
}));

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  loadSession: vi.fn(),
  ensureCurrentAllianceForSession: vi.fn(),
}));

vi.mock("@/lib/member-link/invite-onboarding-access.server", () => ({
  canManageInvitesAndOnboarding: vi.fn(() => true),
}));

const {
  assertInviteRoleAllowed,
  assignableInviteRolesForContext,
  canManageTeamInvites,
  viewerCanIssueLeadershipHybridInvite,
} = await import("@/lib/native-alliance/team-invites.server");

function makeCtx(partial: Partial<RbacContext>): RbacContext {
  return {
    sessionId: "s1",
    hqUserId: "u1",
    email: "officer@test.com",
    displayName: null,
    avatarUrl: null,
    isPlatformMaintainer: false,
    currentAllianceId: "a1",
    roleName: "officer",
    permissions: new Set(["members:write"]),
    ...partial,
  };
}

describe("team invite access", () => {
  beforeEach(() => {
    selectLimit.mockReset();
    selectWhere.mockClear();
    selectFrom.mockClear();
    select.mockClear();
  });

  it("allows officers to invite member roles only (base assignable)", () => {
    const ctx = makeCtx({ roleName: "officer" });
    expect(canManageTeamInvites(ctx)).toBe(true);
    expect(assignableInviteRolesForContext(ctx)).toEqual([
      "data_entry",
      "viewer",
      "member",
    ]);
  });

  it("allows alliance admins to invite officers", async () => {
    const ctx = makeCtx({
      roleName: "owner",
      permissions: new Set(["alliance:admin", "members:write"]),
    });
    expect(assignableInviteRolesForContext(ctx)).toEqual([
      "officer",
      "data_entry",
      "viewer",
      "member",
    ]);
    await expect(assertInviteRoleAllowed(ctx, "officer")).resolves.toBeUndefined();
  });

  it("blocks officer→officer without an R4 claim target", async () => {
    const ctx = makeCtx({ roleName: "officer" });
    await expect(assertInviteRoleAllowed(ctx, "officer")).rejects.toThrow(
      "You cannot assign that invite role.",
    );
  });

  it("allows officer→officer when the claim target is R4", async () => {
    selectLimit.mockResolvedValueOnce([
      { allianceRank: 4, status: "active" },
    ]);
    const ctx = makeCtx({ roleName: "officer" });
    await expect(
      assertInviteRoleAllowed(ctx, "officer", {
        allianceId: "a1",
        targetAshedMemberId: "m-r4",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects officer→officer when the claim target is not R4", async () => {
    selectLimit.mockResolvedValueOnce([
      { allianceRank: 3, status: "active" },
    ]);
    const ctx = makeCtx({ roleName: "officer" });
    await expect(
      assertInviteRoleAllowed(ctx, "officer", {
        allianceId: "a1",
        targetAshedMemberId: "m-r3",
      }),
    ).rejects.toThrow(/R4/);
  });

  it("allows officer→owner when the claim target is R5", async () => {
    selectLimit.mockResolvedValueOnce([
      { allianceRank: 5, status: "active" },
    ]);
    const ctx = makeCtx({ roleName: "officer" });
    await expect(
      assertInviteRoleAllowed(ctx, "owner", {
        allianceId: "a1",
        targetAshedMemberId: "m-r5",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects officer→owner without an R5 claim target", async () => {
    const ctx = makeCtx({ roleName: "officer" });
    await expect(assertInviteRoleAllowed(ctx, "owner")).rejects.toThrow(/R5/);
  });

  it("rejects officer→owner when the claim target is not R5", async () => {
    selectLimit.mockResolvedValueOnce([
      { allianceRank: 4, status: "active" },
    ]);
    const ctx = makeCtx({ roleName: "officer" });
    await expect(
      assertInviteRoleAllowed(ctx, "owner", {
        allianceId: "a1",
        targetAshedMemberId: "m-r4",
      }),
    ).rejects.toThrow(/R5/);
  });

  it("rejects rank exceptions when the claim target is a former member", async () => {
    selectLimit.mockResolvedValueOnce([
      { allianceRank: 4, status: "former" },
    ]);
    const ctx = makeCtx({ roleName: "officer" });
    await expect(
      assertInviteRoleAllowed(ctx, "officer", {
        allianceId: "a1",
        targetAshedMemberId: "m-former",
      }),
    ).rejects.toThrow(/R4/);
  });

  it("allows alliance owner→owner when the claim target is R5", async () => {
    selectLimit.mockResolvedValueOnce([
      { allianceRank: 5, status: "active" },
    ]);
    const ctx = makeCtx({
      roleName: "owner",
      permissions: new Set(["alliance:admin", "members:write"]),
    });
    await expect(
      assertInviteRoleAllowed(ctx, "owner", {
        allianceId: "a1",
        targetAshedMemberId: "m-r5",
      }),
    ).resolves.toBeUndefined();
  });

  it("allows platform maintainers to invite owner without a target", async () => {
    const ctx = makeCtx({
      roleName: "member",
      isPlatformMaintainer: true,
      permissions: new Set(),
    });
    await expect(assertInviteRoleAllowed(ctx, "owner")).resolves.toBeUndefined();
  });

  it("blocks alliance owners from owner invites without an R5 target", async () => {
    const ctx = makeCtx({
      roleName: "owner",
      permissions: new Set(["alliance:admin"]),
    });
    await expect(assertInviteRoleAllowed(ctx, "owner")).rejects.toThrow(/R5/);
  });

  it("denies viewers from managing invites", () => {
    const ctx = makeCtx({
      roleName: "viewer",
      permissions: new Set(["members:read"]),
    });
    expect(canManageTeamInvites(ctx)).toBe(false);
  });

  it("shows leadership hybrid CTA for officers on R4/R5 only", () => {
    const officer = makeCtx({ roleName: "officer" });
    expect(viewerCanIssueLeadershipHybridInvite(officer, 4)).toBe(true);
    expect(viewerCanIssueLeadershipHybridInvite(officer, 5)).toBe(true);
    expect(viewerCanIssueLeadershipHybridInvite(officer, 3)).toBe(false);

    const owner = makeCtx({
      roleName: "owner",
      permissions: new Set(["alliance:admin", "members:write"]),
    });
    expect(viewerCanIssueLeadershipHybridInvite(owner, 4)).toBe(true);
    expect(viewerCanIssueLeadershipHybridInvite(owner, 3)).toBe(false);
  });
});
