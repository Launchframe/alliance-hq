import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), links: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/rbac/context", () => ({ getRbacContext: mocks.context }));
vi.mock("@/lib/time-off/repository.server", () => ({ listLinkedCommanderIdsForHqUser: mocks.links }));
import { requireSupportAccess } from "./access.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "session", hqUserId: "actual-user", currentAllianceId: "alliance" });
  mocks.context.mockResolvedValue({ hqUserId: "actual-user", currentAllianceId: "alliance", roleName: "officer", isPlatformMaintainer: false, permissions: new Set(["support_teams:read", "support_teams:write"]) });
  mocks.links.mockResolvedValue(["first-commander", "second-commander"]);
});
describe("support team authorization architecture", () => {
  it("denies anonymous bootstrap identity even if a permission mock would allow it", async () => {
    mocks.session.mockResolvedValue({ id: "bootstrap", hqUserId: null, currentAllianceId: "alliance" });
    await expect(requireSupportAccess("write")).rejects.toThrow("forbidden");
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("uses session alliance and all linked commanders, not a caller alliance or first commander", async () => {
    const access = await requireSupportAccess("write");
    expect(access.actor).toMatchObject({ allianceId: "alliance", principalId: "actual-user", linkedMemberIds: ["first-commander", "second-commander"] });
    expect(mocks.links).toHaveBeenCalledWith({ allianceId: "alliance", hqUserId: "actual-user" });
  });
  it.each(["member", "viewer", "data_entry"])("limits %s to published reads", async (roleName) => {
    mocks.context.mockResolvedValue({ hqUserId: "actual-user", currentAllianceId: "alliance", roleName, isPlatformMaintainer: false, permissions: new Set(["members:read"]) });
    expect((await requireSupportAccess()).actor.canRead).toBe(false);
    await expect(requireSupportAccess("read")).rejects.toThrow("forbidden");
    await expect(requireSupportAccess("write")).rejects.toThrow("forbidden");
  });
  it("denies tenant mismatch and rank-only leadership", async () => {
    mocks.context.mockResolvedValue({ hqUserId: "actual-user", currentAllianceId: "other", roleName: "owner", permissions: new Set() });
    await expect(requireSupportAccess("write")).rejects.toThrow("forbidden");
    mocks.context.mockResolvedValue({ hqUserId: "actual-user", currentAllianceId: "alliance", roleName: "member", permissions: new Set(["members:read"]) });
    await expect(requireSupportAccess("write")).rejects.toThrow("forbidden");
  });
  it("keeps actual principal attribution during explicit platform-admin impersonation", async () => {
    mocks.context.mockResolvedValue({ hqUserId: "represented-user", currentAllianceId: "alliance", roleName: "member", isPlatformMaintainer: true, permissions: new Set() });
    const access = await requireSupportAccess("write");
    expect(access.actor).toMatchObject({ principalId: "actual-user", override: true });
    expect(mocks.links).toHaveBeenCalledWith({ allianceId: "alliance", hqUserId: "actual-user" });
  });
});
