import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const loadSessionMock = vi.fn();
const authMock = vi.fn();
const getDiscordProviderAccountIdForHqUserMock = vi.fn();
const getValidDiscordAuthNonceMock = vi.fn();
const claimDiscordAuthNonceMock = vi.fn();
const releaseDiscordAuthNonceMock = vi.fn();
const parseConnectionInputMock = vi.fn();
const setupAshedCredentialsForDiscordMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: () => requireApiSessionMock(),
  loadSession: (id: string) => loadSessionMock(id),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/auth/discord-hq-link.server", () => ({
  getDiscordProviderAccountIdForHqUser: (hqUserId: string) =>
    getDiscordProviderAccountIdForHqUserMock(hqUserId),
}));

vi.mock("@/lib/vr/auth-nonce", () => ({
  getValidDiscordAuthNonce: (nonce: string) => getValidDiscordAuthNonceMock(nonce),
  claimDiscordAuthNonce: (nonce: string) => claimDiscordAuthNonceMock(nonce),
  releaseDiscordAuthNonce: (id: string) => releaseDiscordAuthNonceMock(id),
}));

vi.mock("@/lib/connectionString", () => ({
  parseConnectionInput: (key: string) => parseConnectionInputMock(key),
}));

vi.mock("@/lib/vr/discord-ashed-credential-setup.server", () => ({
  setupAshedCredentialsForDiscord: (input: unknown) =>
    setupAshedCredentialsForDiscordMock(input),
}));

import { POST } from "./route";

function postAuthorize(body: Record<string, string>) {
  return POST(
    new Request("http://localhost/api/discord/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const nonceRow = {
  id: "nonce-1",
  purpose: "alliance_credentials",
  tag: "lfgo",
  discordUserId: "discord-1",
};

describe("POST /api/discord/authorize — alliance_credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      id: "sess-1",
      expiresAt: new Date("2030-06-01T00:00:00.000Z"),
    });
    loadSessionMock.mockResolvedValue({
      id: "sess-1",
      expiresAt: new Date("2030-06-01T00:00:00.000Z"),
    });
    authMock.mockResolvedValue({ user: { id: "hq-user-1" } });
    getDiscordProviderAccountIdForHqUserMock.mockResolvedValue("discord-1");
    getValidDiscordAuthNonceMock.mockResolvedValue(nonceRow);
    claimDiscordAuthNonceMock.mockResolvedValue(nonceRow);
    releaseDiscordAuthNonceMock.mockResolvedValue(undefined);
    parseConnectionInputMock.mockReturnValue({
      ok: true,
      connection: {
        token: "jwt-token",
        appId: "app-id",
        originUrl: "https://ashed.online",
      },
    });
    setupAshedCredentialsForDiscordMock.mockResolvedValue({
      ok: true,
      allianceId: "hq-ally-1",
      tag: "LFgo",
    });
  });

  it("delegates credential setup after Discord identity bind + CAS claim", async () => {
    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tag: string };
    expect(body).toEqual({ ok: true, purpose: "alliance_credentials", tag: "LFgo" });
    expect(getDiscordProviderAccountIdForHqUserMock).toHaveBeenCalledWith("hq-user-1");
    expect(claimDiscordAuthNonceMock).toHaveBeenCalledWith("nonce-abc");
    expect(setupAshedCredentialsForDiscordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceTag: "lfgo",
        connectionKey: "connection-key",
        discordUserId: "discord-1",
        sessionExpiresAt: new Date("2030-06-01T00:00:00.000Z"),
      }),
    );
    expect(releaseDiscordAuthNonceMock).not.toHaveBeenCalled();
  });

  it("rejects when HQ Auth.js session is missing (anonymous workspace cookie only)", async () => {
    authMock.mockResolvedValue(null);

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(401);
    expect(setupAshedCredentialsForDiscordMock).not.toHaveBeenCalled();
    expect(claimDiscordAuthNonceMock).not.toHaveBeenCalled();
  });

  it("rejects when signed-in Discord account does not match the nonce Discord user", async () => {
    getDiscordProviderAccountIdForHqUserMock.mockResolvedValue("discord-attacker");

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "owner-connection-key",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/different Discord account/i);
    expect(setupAshedCredentialsForDiscordMock).not.toHaveBeenCalled();
    expect(claimDiscordAuthNonceMock).not.toHaveBeenCalled();
  });

  it("rejects when HQ user has no Discord OAuth provider linked", async () => {
    getDiscordProviderAccountIdForHqUserMock.mockResolvedValue(null);

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(403);
    expect(setupAshedCredentialsForDiscordMock).not.toHaveBeenCalled();
  });

  it("returns 410 when CAS claim loses to a concurrent redeemer", async () => {
    claimDiscordAuthNonceMock.mockResolvedValue(null);

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(410);
    expect(setupAshedCredentialsForDiscordMock).not.toHaveBeenCalled();
  });

  it("releases the claimed nonce when credential setup fails", async () => {
    setupAshedCredentialsForDiscordMock.mockResolvedValue({
      ok: false,
      error: 'Your Ashed account does not have access to alliance tag "other".',
      status: 403,
    });

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(403);
    expect(claimDiscordAuthNonceMock).toHaveBeenCalled();
    expect(releaseDiscordAuthNonceMock).toHaveBeenCalledWith("nonce-1");
  });

  it("returns 422 for invalid connection key before claim/setup", async () => {
    parseConnectionInputMock.mockReturnValue({
      ok: false,
      error: "malformed key",
    });

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "bad-key",
    });

    expect(res.status).toBe(422);
    expect(claimDiscordAuthNonceMock).not.toHaveBeenCalled();
    expect(setupAshedCredentialsForDiscordMock).not.toHaveBeenCalled();
  });
});
