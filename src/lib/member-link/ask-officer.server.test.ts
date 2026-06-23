import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWebMemberLinkAskOfficer } from "./orchestrator.server";

vi.mock("@/lib/events/admin-alerts", () => ({
  emitAdminAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn(),
  getHqMemberLinkPending: vi.fn(),
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/privileged-link.server", () => ({
  assertPrivilegedAshedGate: vi.fn().mockResolvedValue({ ok: true }),
  sessionHasLiveAshedVerification: vi.fn(),
}));

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext: vi.fn().mockResolvedValue(null),
}));

const repository = await import("@/lib/member-link/repository.server");

describe("runWebMemberLinkAskOfficer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.getHqMemberLinkForUser).mockResolvedValue(null as never);
    vi.mocked(repository.getHqMemberLinkPending).mockResolvedValue(null);
  });

  it("rejects when no roster_miss pending state exists", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });

    expect(result.outcome).toBe("usage");
    expect(repository.saveHqMemberLinkPending).not.toHaveBeenCalled();
  });

  it("notifies officers and clears pending when roster_miss is active", async () => {
    vi.mocked(repository.getHqMemberLinkPending).mockResolvedValue({
      allianceId: "a1",
      pending: { kind: "link_roster_miss" },
    });

    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      displayName: "Player",
    });

    expect(result.outcome).toBe("officer_notified");
    expect(repository.saveHqMemberLinkPending).toHaveBeenCalledWith(
      "a1",
      "u1",
      null,
    );
  });
});
