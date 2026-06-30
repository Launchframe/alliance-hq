import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWebMemberLinkAskOfficer } from "./orchestrator.server";

const { emitAdminAlert, lookupPlayerByUid, recordMemberLinkHelpRequest } =
  vi.hoisted(() => ({
    emitAdminAlert: vi.fn().mockResolvedValue(undefined),
    lookupPlayerByUid: vi.fn(),
    recordMemberLinkHelpRequest: vi.fn().mockResolvedValue("help-req-1"),
  }));

vi.mock("@/lib/events/admin-alerts", () => ({
  emitAdminAlert,
}));

vi.mock("@/lib/lastwar/player-lookup", () => ({
  lookupPlayerByUid,
}));

vi.mock("@/lib/member-link/member-link-help-queue.server", () => ({
  recordMemberLinkHelpRequest,
  resolveWebHelpContext: vi.fn().mockReturnValue("onboarding_form"),
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

const validUid = "1001369694001203";
const validName = "Commander Alpha";

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

  it("rejects when name and uid are missing", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });

    expect(result.outcome).toBe("usage");
    expect(recordMemberLinkHelpRequest).not.toHaveBeenCalled();
    expect(emitAdminAlert).not.toHaveBeenCalled();
  });

  it("rejects when uid is invalid", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: validName,
      gameUid: "not-a-uid",
    });

    expect(result.outcome).toBe("usage");
    expect(emitAdminAlert).not.toHaveBeenCalled();
  });

  it("rejects when name is missing even with valid uid", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: validUid,
    });

    expect(result.outcome).toBe("usage");
    expect(recordMemberLinkHelpRequest).not.toHaveBeenCalled();
  });

  it("rejects walkthrough pending without name and uid", async () => {
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

    expect(result.outcome).toBe("usage");
    expect(recordMemberLinkHelpRequest).not.toHaveBeenCalled();
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
      reportedName: validName,
      gameUid: validUid,
    });

    expect(result.outcome).toBe("officer_notified");
    expect(repository.saveHqMemberLinkPending).toHaveBeenCalledWith(
      "a1",
      "u1",
      null,
    );
    expect(recordMemberLinkHelpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        hqUserId: "u1",
        origin: "web",
        reportedName: validName,
        gameUid: validUid,
      }),
    );
  });

  it("notifies officers when name and uid are provided", async () => {
    const result = await runWebMemberLinkAskOfficer({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: validName,
      gameUid: validUid,
    });

    expect(result.outcome).toBe("officer_notified");
    expect(lookupPlayerByUid).toHaveBeenCalledWith(validUid);
    expect(recordMemberLinkHelpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedName: validName,
        gameUid: validUid,
        gameUserName: "Commander Alpha",
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
      reportedName: validName,
      gameUid: validUid,
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
