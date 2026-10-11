import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSession = vi.fn();
const resolveEffectiveHqUserIdForSession = vi.fn();
const sessionHoldsAshedIdentityForHqUser = vi.fn();
const getAshedCredentialRecord = vi.fn();
const getAshedConnection = vi.fn();
const resolveAshedConnectionForAlliance = vi.fn();
const requireActiveShareCapability = vi.fn();
const verifyBase44Connection = vi.fn();
const base44ListAlliances = vi.fn();
const filterAccessibleAlliances = vi.fn();
const canInstallAshedBotCredentials = vi.fn();
const syncAshedAllianceForBot = vi.fn();
const upsertAllianceAshedCredential = vi.fn();
const decryptSecret = vi.fn((value: string) => `decrypted:${value}`);
const encryptSecret = vi.fn((value: string) => `encrypted:${value}`);
const resolveTokenExpiresAt = vi.fn((_token?: string) =>
  new Date("2099-01-01T00:00:00.000Z"),
);

const allianceSelect = vi.fn();

vi.mock("@/lib/session", () => ({
  loadSession: (...args: unknown[]) => loadSession(...args),
  resolveEffectiveHqUserIdForSession: (...args: unknown[]) =>
    resolveEffectiveHqUserIdForSession(...args),
  getAshedCredentialRecord: (...args: unknown[]) =>
    getAshedCredentialRecord(...args),
  getAshedConnection: (...args: unknown[]) => getAshedConnection(...args),
}));

vi.mock("@/lib/rbac/ashed-session-membership", () => ({
  sessionHoldsAshedIdentityForHqUser: (...args: unknown[]) =>
    sessionHoldsAshedIdentityForHqUser(...args),
}));

vi.mock("@/lib/ashed/credential-share.server", () => ({
  resolveAshedConnectionForAlliance: (...args: unknown[]) =>
    resolveAshedConnectionForAlliance(...args),
  requireActiveShareCapability: (...args: unknown[]) =>
    requireActiveShareCapability(...args),
}));

vi.mock("@/lib/base44/server", () => ({
  verifyBase44Connection: (...args: unknown[]) =>
    verifyBase44Connection(...args),
}));

vi.mock("@/lib/base44/fetch", () => ({
  base44ListAlliances: (...args: unknown[]) => base44ListAlliances(...args),
}));

vi.mock("@/lib/alliance/accessible", () => ({
  filterAccessibleAlliances: (...args: unknown[]) =>
    filterAccessibleAlliances(...args),
  canInstallAshedBotCredentials: (...args: unknown[]) =>
    canInstallAshedBotCredentials(...args),
}));

vi.mock("@/lib/rbac/sync-ashed-roles", () => ({
  syncAshedAllianceForBot: (...args: unknown[]) =>
    syncAshedAllianceForBot(...args),
}));

vi.mock("@/lib/vr/repository", () => ({
  upsertAllianceAshedCredential: (...args: unknown[]) =>
    upsertAllianceAshedCredential(...args),
}));

vi.mock("@/lib/crypto/encrypt", () => ({
  encryptSecret: (value: string) => encryptSecret(value),
  decryptSecret: (value: string) => decryptSecret(value),
}));

vi.mock("@/lib/jwt/connection-meta", () => ({
  resolveTokenExpiresAt: (token: string) => resolveTokenExpiresAt(token),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => allianceSelect(...args),
        }),
      }),
    }),
  }),
  schema: {
    alliances: { id: "id", tag: "tag" },
  },
}));

describe("upsertAllianceAshedCredentialsFromSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSession.mockResolvedValue({ hqUserId: "hq-1" });
    resolveEffectiveHqUserIdForSession.mockResolvedValue("hq-1");
    sessionHoldsAshedIdentityForHqUser.mockResolvedValue(true);
    getAshedCredentialRecord.mockResolvedValue({
      appId: "app",
      originUrl: "https://ashed.example",
      encryptedToken: "tok",
    });
    getAshedConnection.mockResolvedValue(null);
    resolveAshedConnectionForAlliance.mockResolvedValue(null);
    requireActiveShareCapability.mockResolvedValue(null);
    verifyBase44Connection.mockResolvedValue({
      id: "ashed-user",
      email: "collab@example.com",
      full_name: "Collab",
    });
    allianceSelect.mockResolvedValue([{ id: "alliance-1", tag: "LFgo" }]);
    base44ListAlliances.mockResolvedValue([{ id: "a1", tag: "LFgo" }]);
    filterAccessibleAlliances.mockReturnValue([
      { id: "a1", tag: "LFgo", accessRole: "maintainer" },
    ]);
    canInstallAshedBotCredentials.mockReturnValue(false);
  });

  it("rejects Ashed collaborators/maintainers before upserting bot credentials", async () => {
    const { upsertAllianceAshedCredentialsFromSession } = await import(
      "./alliance-credentials-manage.server"
    );

    const result = await upsertAllianceAshedCredentialsFromSession({
      sessionId: "sess-1",
      allianceId: "alliance-1",
    });

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: expect.stringContaining("Only the Ashed alliance owner"),
    });
    expect(canInstallAshedBotCredentials).toHaveBeenCalledWith("maintainer");
    expect(upsertAllianceAshedCredential).not.toHaveBeenCalled();
    expect(syncAshedAllianceForBot).not.toHaveBeenCalled();
  });

  it("allows Ashed maintainers when allowAshedMaintainer is set for time-off repair", async () => {
    syncAshedAllianceForBot.mockResolvedValue({
      hqAllianceId: "alliance-1",
      hqUserId: "hq-1",
      roleName: "maintainer",
    });

    const { upsertAllianceAshedCredentialsFromSession } = await import(
      "./alliance-credentials-manage.server"
    );

    const result = await upsertAllianceAshedCredentialsFromSession({
      sessionId: "sess-1",
      allianceId: "alliance-1",
      allowAshedMaintainer: true,
    });

    expect(result).toEqual({ ok: true });
    expect(syncAshedAllianceForBot).toHaveBeenCalled();
    expect(upsertAllianceAshedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ registeredByHqUserId: "hq-1" }),
    );
  });

  it("delegated owner-key install must stamp share owner, not delegate", async () => {
    loadSession.mockResolvedValue({ hqUserId: "hq-delegate" });
    resolveEffectiveHqUserIdForSession.mockResolvedValue("hq-delegate");
    sessionHoldsAshedIdentityForHqUser.mockResolvedValue(false);
    resolveAshedConnectionForAlliance.mockResolvedValue({
      connection: {
        appId: "shared-app",
        originUrl: "https://ashed.example",
        token: "owner-shared-token",
      },
      shareId: "share-1",
      isDelegated: true,
    });
    requireActiveShareCapability.mockResolvedValue({
      connection: {
        appId: "shared-app",
        originUrl: "https://ashed.example",
        token: "owner-shared-token",
      },
      shareId: "share-1",
      ownerHqUserId: "hq-owner",
    });
    verifyBase44Connection.mockResolvedValue({
      id: "ashed-owner",
      email: "owner@example.com",
      full_name: "Owner",
    });
    filterAccessibleAlliances.mockReturnValue([
      { id: "a1", tag: "LFgo", accessRole: "owner" },
    ]);
    canInstallAshedBotCredentials.mockReturnValue(true);
    syncAshedAllianceForBot.mockResolvedValue({
      hqAllianceId: "alliance-1",
      hqUserId: "hq-delegate",
      roleName: "owner",
    });

    const { upsertAllianceAshedCredentialsFromSession } = await import(
      "./alliance-credentials-manage.server"
    );

    const result = await upsertAllianceAshedCredentialsFromSession({
      sessionId: "sess-delegate",
      allianceId: "alliance-1",
    });

    expect(result).toEqual({ ok: true });
    expect(requireActiveShareCapability).toHaveBeenCalledWith({
      sessionId: "sess-delegate",
      allianceId: "alliance-1",
      capability: "alliance_credentials:manage",
      delegatedAction: "alliance_credentials.upsert",
    });
    // Before fix: registeredByHqUserId was "hq-delegate" (sticky #749 hole).
    expect(upsertAllianceAshedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ registeredByHqUserId: "hq-owner" }),
    );
    const payload = upsertAllianceAshedCredential.mock.calls[0][0];
    expect(payload.registeredByHqUserId).not.toBe("hq-delegate");
  });

  it("allows maintainer credential shares for time-off repair via alliance_credentials:manage", async () => {
    sessionHoldsAshedIdentityForHqUser.mockResolvedValue(false);
    resolveAshedConnectionForAlliance.mockResolvedValue({
      connection: {
        appId: "shared-app",
        originUrl: "https://ashed.example",
        token: "shared-token",
      },
      shareId: "share-1",
      isDelegated: true,
    });
    requireActiveShareCapability.mockResolvedValue({
      connection: {
        appId: "shared-app",
        originUrl: "https://ashed.example",
        token: "shared-token",
      },
      shareId: "share-1",
      ownerHqUserId: "hq-owner",
    });
    syncAshedAllianceForBot.mockResolvedValue({
      hqAllianceId: "alliance-1",
      hqUserId: "hq-1",
      roleName: "maintainer",
    });

    const { upsertAllianceAshedCredentialsFromSession } = await import(
      "./alliance-credentials-manage.server"
    );

    const result = await upsertAllianceAshedCredentialsFromSession({
      sessionId: "sess-1",
      allianceId: "alliance-1",
      allowAshedMaintainer: true,
    });

    expect(result).toEqual({ ok: true });
    expect(requireActiveShareCapability).toHaveBeenCalledWith({
      sessionId: "sess-1",
      allianceId: "alliance-1",
      capability: "alliance_credentials:manage",
      delegatedAction: "alliance_credentials.upsert",
    });
    expect(upsertAllianceAshedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ registeredByHqUserId: "hq-owner" }),
    );
  });

  it("allows Ashed owners and does not clear Discord registrant on upsert", async () => {
    filterAccessibleAlliances.mockReturnValue([
      { id: "a1", tag: "LFgo", accessRole: "owner" },
    ]);
    canInstallAshedBotCredentials.mockReturnValue(true);
    syncAshedAllianceForBot.mockResolvedValue({
      hqAllianceId: "alliance-1",
      hqUserId: "hq-1",
      roleName: "owner",
    });

    const { upsertAllianceAshedCredentialsFromSession } = await import(
      "./alliance-credentials-manage.server"
    );

    const result = await upsertAllianceAshedCredentialsFromSession({
      sessionId: "sess-1",
      allianceId: "alliance-1",
    });

    expect(result).toEqual({ ok: true });
    expect(upsertAllianceAshedCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "alliance-1",
        registeredByHqUserId: "hq-1",
      }),
    );
    const payload = upsertAllianceAshedCredential.mock.calls[0][0];
    expect(payload).not.toHaveProperty("registeredByDiscordUserId");
  });
});
