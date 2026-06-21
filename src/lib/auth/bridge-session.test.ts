import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveBridgeHqUserId } from "@/lib/auth/bridge-session";
import * as sessionModule from "@/lib/session";
import * as ashedMembershipModule from "@/lib/rbac/ashed-session-membership";

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
    vi.spyOn(sessionModule, "resolveEffectiveHqUserIdForSession").mockResolvedValue(
      "canonical-user",
    );
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
    vi.spyOn(sessionModule, "resolveEffectiveHqUserIdForSession").mockResolvedValue(
      "user-b",
    );
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
