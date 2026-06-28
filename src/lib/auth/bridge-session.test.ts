import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bridgeAuthUserToPageSession,
  resolveBridgeHqUserId,
} from "@/lib/auth/bridge-session";
import * as sessionConnectIdentity from "@/lib/auth/session-connect-identity";
import * as sessionModule from "@/lib/session";
import * as ashedMembershipModule from "@/lib/rbac/ashed-session-membership";

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  }),
  schema: {
    hqUsers: { id: "hqUsers.id" },
    sessions: { id: "sessions.id" },
  },
}));

describe("bridgeAuthUserToPageSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls requirePageSession before getOrCreateSession", async () => {
    const callOrder: string[] = [];
    vi.spyOn(sessionModule, "requirePageSession").mockImplementation(async () => {
      callOrder.push("requirePageSession");
      return { id: "sess-1" } as never;
    });
    vi.spyOn(sessionModule, "getOrCreateSession").mockImplementation(async () => {
      callOrder.push("getOrCreateSession");
      return { id: "sess-1", hqUserId: null, userLabel: null } as never;
    });
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: null,
    } as never);
    vi.spyOn(
      ashedMembershipModule,
      "sessionHoldsAshedIdentityForHqUser",
    ).mockResolvedValue(false);
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue(null);

    await bridgeAuthUserToPageSession(
      { hqUserId: "user-b", email: "user@example.com" },
      "/trains",
    );

    expect(sessionModule.requirePageSession).toHaveBeenCalledWith("/trains");
    expect(callOrder[0]).toBe("requirePageSession");
    expect(callOrder.indexOf("getOrCreateSession")).toBeGreaterThan(0);
  });
});

describe("resolveBridgeHqUserId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the session owner when they already hold the Ashed credential", async () => {
    vi.spyOn(sessionModule, "getOrCreateSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "canonical-user",
    } as never);
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "canonical-user",
    } as never);
    vi.spyOn(
      ashedMembershipModule,
      "sessionHoldsAshedIdentityForHqUser",
    ).mockImplementation(async (_sessionId, hqUserId) => hqUserId === "canonical-user");
    vi.spyOn(
      sessionConnectIdentity,
      "signingInUserMatchesConnectedSessionOwner",
    ).mockResolvedValue(true);
    const clearSpy = vi
      .spyOn(sessionModule, "clearAshedConnection")
      .mockResolvedValue(undefined);

    await expect(
      resolveBridgeHqUserId({ hqUserId: "magic-stub" }),
    ).resolves.toBe("canonical-user");
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("clears orphan Ashed credentials that do not match the signing-in user", async () => {
    vi.spyOn(sessionModule, "getOrCreateSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-a",
    } as never);
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-a",
    } as never);
    vi.spyOn(
      ashedMembershipModule,
      "sessionHoldsAshedIdentityForHqUser",
    ).mockResolvedValue(false);
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue({
      id: "cred-1",
    } as never);
    const clearSpy = vi
      .spyOn(sessionModule, "clearAshedConnection")
      .mockResolvedValue(undefined);

    await expect(
      resolveBridgeHqUserId({ hqUserId: "user-b" }),
    ).resolves.toBe("user-b");
    expect(clearSpy).toHaveBeenCalledWith("sess-1");
  });

  it("uses the signing-in user when they hold the matching credential", async () => {
    vi.spyOn(sessionModule, "getOrCreateSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: null,
    } as never);
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: null,
    } as never);
    vi.spyOn(
      ashedMembershipModule,
      "sessionHoldsAshedIdentityForHqUser",
    ).mockImplementation(async (_sessionId, hqUserId) => hqUserId === "user-b");
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue({
      id: "cred-1",
    } as never);
    vi.spyOn(sessionModule, "resolveEffectiveHqUserIdForSession").mockResolvedValue(
      "user-b",
    );
    const clearSpy = vi
      .spyOn(sessionModule, "clearAshedConnection")
      .mockResolvedValue(undefined);

    await expect(
      resolveBridgeHqUserId({ hqUserId: "user-b" }),
    ).resolves.toBe("user-b");
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("clears stale cred when a different user signs in on a cred-bound session", async () => {
    vi.spyOn(sessionModule, "getOrCreateSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-a",
    } as never);
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-a",
    } as never);
    vi.spyOn(
      ashedMembershipModule,
      "sessionHoldsAshedIdentityForHqUser",
    ).mockImplementation(async (_sessionId, hqUserId) => hqUserId === "user-a");
    vi.spyOn(
      sessionConnectIdentity,
      "signingInUserMatchesConnectedSessionOwner",
    ).mockResolvedValue(false);
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue({
      id: "cred-1",
    } as never);
    const clearSpy = vi
      .spyOn(sessionModule, "clearAshedConnection")
      .mockResolvedValue(undefined);

    await expect(
      resolveBridgeHqUserId({ hqUserId: "user-b" }),
    ).resolves.toBe("user-b");
    expect(clearSpy).toHaveBeenCalledWith("sess-1");
  });
});
