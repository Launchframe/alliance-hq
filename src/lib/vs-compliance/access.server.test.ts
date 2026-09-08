import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), membership: vi.fn(), permission: vi.fn(), session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac/context", () => ({ getRbacContext: mocks.context, getAllianceMembershipRbac: mocks.membership, sessionHasPermissionForAlliance: mocks.permission }));
vi.mock("@/lib/session", () => ({ loadSession: mocks.session }));
import { requireVsComplianceAccess } from "./access.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ hqUserId: "canonical", roleName: "owner", isPlatformMaintainer: false, permissions: new Set(), currentAllianceId: "other-alliance" });
  mocks.session.mockResolvedValue({ hqUserId: "session-user" });
  mocks.membership.mockResolvedValue({ roleName: "officer", permissions: new Set(["vs_compliance:read", "vs_compliance:manage"]) });
  mocks.permission.mockResolvedValue(true);
});

describe("alliance-scoped discipline access", () => {
  it("checks the requested tenant and canonical identity, not a role from another current alliance", async () => {
    const actor = await requireVsComplianceAccess("session", "target-alliance", "vs_compliance:manage");
    expect(actor).toEqual({ sessionId: "session", allianceId: "target-alliance", hqUserId: "canonical", boundHqUserId: "session-user" });
    expect(mocks.membership).toHaveBeenCalledWith("session", "canonical", "target-alliance");
    expect(mocks.permission).toHaveBeenCalledWith("session", "target-alliance", "vs_compliance:manage");
    await expect(requireVsComplianceAccess("session", "target-alliance", "vs_compliance:settings")).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("requires the existing permission primitive as well as leadership role", async () => {
    mocks.permission.mockResolvedValue(false);
    await expect(requireVsComplianceAccess("session", "target-alliance", "vs_compliance:manage")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("denies anonymous bootstrap context before tenant reads", async () => {
    mocks.context.mockResolvedValue(null);
    await expect(requireVsComplianceAccess("session", "target-alliance", "vs_compliance:read")).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it("denies a missing bound identity even if an inconsistent context claims leadership", async () => {
    mocks.session.mockResolvedValue({ hqUserId: null });
    await expect(requireVsComplianceAccess("session", "target-alliance", "vs_compliance:read")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("denies cross-tenant members and data-entry even when members:write is present", async () => {
    for (const roleName of [null, "member", "data_entry"]) {
      mocks.membership.mockResolvedValue({ roleName, permissions: new Set(["members:write", "vs_compliance:manage"]) });
      await expect(requireVsComplianceAccess("session", "target-alliance", "vs_compliance:manage")).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
