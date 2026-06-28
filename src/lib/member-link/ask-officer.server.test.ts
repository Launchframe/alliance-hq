import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWebMemberLinkAskOfficer } from "./orchestrator.server";

const { emitAdminAlert, lookupPlayerByUid } = vi.hoisted(() => ({
  emitAdminAlert: vi.fn().mockResolvedValue(undefined),
  lookupPlayerByUid: vi.fn(),
}));

vi.mock("@/lib/events/admin-alerts", () => ({
  emitAdminAlert,
}));

vi.mock("@/lib/lastwar/player-lookup", () => ({
  lookupPlayerByUid,
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn(),
  getHqMemberLinkPending: vi.fn(),
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Commander Alpha",
      gameServerNumber: 1203,
      gameUserLevel: 30,
    });
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
    expect(emitAdminAlert).not.toHaveBeenCalled();
  });

  it("rejects when uid is invalid and no pending state exists", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "not-a-uid",
    });

    expect(result.outcome).toBe("usage");
    expect(emitAdminAlert).not.toHaveBeenCalled();
  });

  it("notifies officers and clears pending when walkthrough is active", async () => {
    vi.mocked(repository.getHqMemberLinkPending).mockResolvedValue({
      allianceId: "a1",
      pending: { kind: "link_walkthrough", step: 0 },
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
    expect(emitAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vr_link_attention",
        handles: ["Player"],
      }),
    );
  });

  it("notifies officers when uid is provided without pending state", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "1001369694001203",
    });

    expect(result.outcome).toBe("officer_notified");
    expect(repository.saveHqMemberLinkPending).not.toHaveBeenCalled();
    expect(lookupPlayerByUid).toHaveBeenCalledWith(
      "1001369694001203",
    );
    expect(emitAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vr_link_attention",
        handles: ["u1 · Commander Alpha"],
      }),
    );
    const payload = emitAdminAlert.mock.calls[0]?.[0] as {
      handles: string[];
    };
    expect(JSON.stringify(payload)).not.toMatch(/1001369694001203/);
  });

  it("notifies officers when name and uid are provided without pending state", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1001369694001203",
    });

    expect(result.outcome).toBe("officer_notified");
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
    expect(emitAdminAlert).toHaveBeenCalled();
  });
});
