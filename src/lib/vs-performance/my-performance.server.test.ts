import { beforeEach, describe, expect, it, vi } from "vitest";

import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

const state = vi.hoisted(() => ({ scoresRead: vi.fn(), compliance: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac/require-permission", () => ({ requireAlliancePermission: state.scoresRead }));
vi.mock("@/lib/vs-compliance/access.server", () => ({ requireVsComplianceAccess: state.compliance }));

import { myVsOfficerHref } from "./my-performance.server";

describe("myVsOfficerHref", () => {
  beforeEach(() => {
    state.scoresRead.mockReset().mockResolvedValue(null);
    state.compliance.mockReset().mockResolvedValue(undefined);
  });

  it("returns the member detail href only when scores:read and vs_compliance:read both pass", async () => {
    await expect(myVsOfficerHref("s", "a", "m-1")).resolves.toBe("/vs-performance/members/m-1");
    expect(state.scoresRead).toHaveBeenCalledWith("s", "a", "scores:read");
  });

  it("returns null without calling compliance when scores:read is denied", async () => {
    state.scoresRead.mockResolvedValue({ status: 403 });
    await expect(myVsOfficerHref("s", "a", "m-1")).resolves.toBeNull();
    expect(state.compliance).not.toHaveBeenCalled();
  });

  it("returns null when compliance access is forbidden and rethrows other errors", async () => {
    state.compliance.mockRejectedValue(new VsComplianceError("forbidden", 403));
    await expect(myVsOfficerHref("s", "a", "m-1")).resolves.toBeNull();
    state.compliance.mockRejectedValue(new Error("db down"));
    await expect(myVsOfficerHref("s", "a", "m-1")).rejects.toThrow("db down");
  });

  it("returns null for a missing member", async () => {
    await expect(myVsOfficerHref("s", "a", null)).resolves.toBeNull();
    expect(state.scoresRead).not.toHaveBeenCalled();
  });
});
