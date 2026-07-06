import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrCreateSessionMock = vi.fn();
const loadSessionMock = vi.fn();
const getValidDiscordAuthNonceMock = vi.fn();
const consumeDiscordAuthNonceMock = vi.fn();
const parseConnectionInputMock = vi.fn();
const setupAshedCredentialsForDiscordMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
  loadSession: (id: string) => loadSessionMock(id),
}));

vi.mock("@/lib/vr/auth-nonce", () => ({
  getValidDiscordAuthNonce: (nonce: string) => getValidDiscordAuthNonceMock(nonce),
  consumeDiscordAuthNonce: (id: string) => consumeDiscordAuthNonceMock(id),
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

describe("POST /api/discord/authorize — alliance_credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-1",
      expiresAt: new Date("2030-06-01T00:00:00.000Z"),
    });
    loadSessionMock.mockResolvedValue({
      id: "sess-1",
      expiresAt: new Date("2030-06-01T00:00:00.000Z"),
    });
    getValidDiscordAuthNonceMock.mockResolvedValue({
      id: "nonce-1",
      purpose: "alliance_credentials",
      tag: "lfgo",
      discordUserId: "discord-1",
    });
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
    consumeDiscordAuthNonceMock.mockResolvedValue(undefined);
  });

  it("delegates credential setup to setupAshedCredentialsForDiscord", async () => {
    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tag: string };
    expect(body).toEqual({ ok: true, purpose: "alliance_credentials", tag: "LFgo" });
    expect(setupAshedCredentialsForDiscordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceTag: "lfgo",
        connectionKey: "connection-key",
        discordUserId: "discord-1",
        sessionExpiresAt: new Date("2030-06-01T00:00:00.000Z"),
      }),
    );
    expect(consumeDiscordAuthNonceMock).toHaveBeenCalledWith("nonce-1");
  });

  it("returns setup error status from setupAshedCredentialsForDiscord", async () => {
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
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('alliance tag "other"');
    expect(consumeDiscordAuthNonceMock).not.toHaveBeenCalled();
  });

  it("returns 422 for invalid connection key before setup", async () => {
    parseConnectionInputMock.mockReturnValue({
      ok: false,
      error: "malformed key",
    });

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "bad-key",
    });

    expect(res.status).toBe(422);
    expect(setupAshedCredentialsForDiscordMock).not.toHaveBeenCalled();
  });
});
