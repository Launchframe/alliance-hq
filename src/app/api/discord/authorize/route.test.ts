import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrCreateSessionMock = vi.fn();
const getValidDiscordAuthNonceMock = vi.fn();
const consumeDiscordAuthNonceMock = vi.fn();
const verifyBase44ConnectionMock = vi.fn();
const base44ListAlliancesMock = vi.fn();
const syncAshedAllianceForBotMock = vi.fn();
const upsertAllianceAshedCredentialMock = vi.fn();
const encryptSecretMock = vi.fn();
const resolveTokenExpiresAtMock = vi.fn();
const capTokenExpiresAtAtSessionMock = vi.fn();
const isTokenExpiredMock = vi.fn();
const parseConnectionInputMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
}));

vi.mock("@/lib/vr/auth-nonce", () => ({
  getValidDiscordAuthNonce: (nonce: string) => getValidDiscordAuthNonceMock(nonce),
  consumeDiscordAuthNonce: (id: string) => consumeDiscordAuthNonceMock(id),
}));

vi.mock("@/lib/connectionString", () => ({
  parseConnectionInput: (key: string) => parseConnectionInputMock(key),
}));

vi.mock("@/lib/base44/server", () => ({
  verifyBase44Connection: (connection: unknown) =>
    verifyBase44ConnectionMock(connection),
}));

vi.mock("@/lib/base44/fetch", () => ({
  base44ListAlliances: (connection: unknown) => base44ListAlliancesMock(connection),
}));

vi.mock("@/lib/rbac/sync-ashed-roles", () => ({
  syncAshedAllianceForBot: (input: unknown) => syncAshedAllianceForBotMock(input),
}));

vi.mock("@/lib/vr/repository", () => ({
  upsertAllianceAshedCredential: (input: unknown) =>
    upsertAllianceAshedCredentialMock(input),
}));

vi.mock("@/lib/crypto/encrypt", () => ({
  encryptSecret: (value: string) => encryptSecretMock(value),
}));

vi.mock("@/lib/jwt/connection-meta", () => ({
  resolveTokenExpiresAt: (token: string) => resolveTokenExpiresAtMock(token),
}));

vi.mock("@/lib/member-link/privileged-link.shared", () => ({
  capTokenExpiresAtAtSession: (jwtExp: Date | null, sessionExpiresAt: Date | null) =>
    capTokenExpiresAtAtSessionMock(jwtExp, sessionExpiresAt),
}));

vi.mock("@/lib/jwt/decode", () => ({
  isTokenExpired: (value: Date | null) => isTokenExpiredMock(value),
}));

import { POST } from "./route";

const LFgoAlliance = {
  id: "6a034217c66737ea6bef7187",
  tag: "LFgo",
  name: "Live Free Die Hard",
  owner_id: "owner-ashed-id",
  owner_email: "owner@example.com",
  collaborators: ["collab@example.com"],
};

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
    verifyBase44ConnectionMock.mockResolvedValue({
      email: "collab@example.com",
      id: "collab-ashed-id",
      full_name: "Collaborator",
    });
    base44ListAlliancesMock.mockResolvedValue([LFgoAlliance]);
    syncAshedAllianceForBotMock.mockResolvedValue({
      hqAllianceId: "hq-ally-1",
      hqUserId: "hq-user-1",
      roleName: "officer",
    });
    resolveTokenExpiresAtMock.mockReturnValue(new Date("2030-01-01T00:00:00.000Z"));
    capTokenExpiresAtAtSessionMock.mockImplementation(
      (value: Date | null) => value,
    );
    isTokenExpiredMock.mockReturnValue(false);
    encryptSecretMock.mockReturnValue("encrypted-token");
    consumeDiscordAuthNonceMock.mockResolvedValue(undefined);
    upsertAllianceAshedCredentialMock.mockResolvedValue(undefined);
  });

  it("allows an Ashed collaborator (not owner) to link credentials for the nonce tag", async () => {
    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tag: string };
    expect(body).toEqual({ ok: true, purpose: "alliance_credentials", tag: "LFgo" });
    expect(syncAshedAllianceForBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceTag: "lfgo",
        currentUser: expect.objectContaining({ email: "collab@example.com" }),
      }),
    );
    expect(upsertAllianceAshedCredentialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "hq-ally-1",
        registeredByDiscordUserId: "discord-1",
        registeredByHqUserId: "hq-user-1",
      }),
    );
    expect(consumeDiscordAuthNonceMock).toHaveBeenCalledWith("nonce-1");
  });

  it("returns 403 when the connection key has no access to the nonce alliance tag", async () => {
    getValidDiscordAuthNonceMock.mockResolvedValue({
      id: "nonce-2",
      purpose: "alliance_credentials",
      tag: "other",
      discordUserId: "discord-1",
    });

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('alliance tag "other"');
    expect(syncAshedAllianceForBotMock).not.toHaveBeenCalled();
    expect(upsertAllianceAshedCredentialMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the Ashed account has no owner or collaborator access", async () => {
    verifyBase44ConnectionMock.mockResolvedValue({
      email: "stranger@example.com",
      id: "stranger-id",
    });

    const res = await postAuthorize({
      nonce: "nonce-abc",
      connectionKey: "connection-key",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("does not have access");
    expect(syncAshedAllianceForBotMock).not.toHaveBeenCalled();
  });
});
