import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSession = vi.fn();
const resolveEffectiveHqUserIdForSession = vi.fn();
const sessionHoldsAshedIdentityForHqUser = vi.fn();
const getAshedCredentialRecord = vi.fn();
const loadAshedConnectionForAllianceCapability = vi.fn();
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
}));

vi.mock("@/lib/rbac/ashed-session-membership", () => ({
  sessionHoldsAshedIdentityForHqUser: (...args: unknown[]) =>
    sessionHoldsAshedIdentityForHqUser(...args),
}));

vi.mock("@/lib/ashed/load-ashed-connection.server", () => ({
  loadAshedConnectionForAllianceCapability: (...args: unknown[]) =>
    loadAshedConnectionForAllianceCapability(...args),
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
