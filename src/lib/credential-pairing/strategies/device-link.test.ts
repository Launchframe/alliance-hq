import { beforeEach, describe, expect, it, vi } from "vitest";

import { PairingError } from "@/lib/credential-pairing/types";
import type { Session } from "@/lib/db/schema";

import { deviceLinkStrategy } from "./device-link";

const copyMock = vi.fn();
const registerMock = vi.fn();
const getAshedConnectionMock = vi.fn();
const verifyBase44ConnectionMock = vi.fn();

vi.mock("@/lib/credential-pairing/copy-credentials", () => ({
  copyEncryptedCredentialsToSession: (...args: unknown[]) => copyMock(...args),
}));

vi.mock("@/lib/credential-pairing/linked-devices", () => ({
  registerLinkedDevice: (...args: unknown[]) => registerMock(...args),
}));

vi.mock("@/lib/session", () => ({
  getAshedConnection: (...args: unknown[]) => getAshedConnectionMock(...args),
  loadSession: vi.fn(),
}));

vi.mock("@/lib/base44/server", () => ({
  verifyBase44Connection: (...args: unknown[]) => verifyBase44ConnectionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
  schema: {
    sessions: { id: "sessions.id" },
  },
}));

function legacySession(overrides: Partial<Session> = {}): Session {
  return {
    id: "desktop-sess",
    userLabel: "Commander",
    allianceId: "alliance-1",
    allianceTag: "LFgo",
    hqUserId: null,
    currentAllianceId: "alliance-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe("deviceLinkStrategy.validateCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects legacy sessions without hqUserId before checking Ashed connection", async () => {
    getAshedConnectionMock.mockResolvedValue({ appId: "app", token: "t" });

    await expect(
      deviceLinkStrategy.validateCreate({
        sourceSession: legacySession(),
        metadata: {},
      }),
    ).rejects.toMatchObject({
      code: "NOT_CONNECTED",
    });

    expect(getAshedConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects when desktop is not connected to Ashed", async () => {
    getAshedConnectionMock.mockResolvedValue(null);

    await expect(
      deviceLinkStrategy.validateCreate({
        sourceSession: legacySession({ hqUserId: "hq-1" }),
        metadata: {},
      }),
    ).rejects.toMatchObject({
      code: "NOT_CONNECTED",
    });
  });

  it("allows create when hqUserId and Ashed connection exist", async () => {
    getAshedConnectionMock.mockResolvedValue({ appId: "app", token: "t" });

    await expect(
      deviceLinkStrategy.validateCreate({
        sourceSession: legacySession({ hqUserId: "hq-1" }),
        metadata: {},
      }),
    ).resolves.toBeUndefined();
  });
});

describe("deviceLinkStrategy.onComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMock.mockResolvedValue("device-1");
  });

  it("rejects legacy source sessions before copying credentials", async () => {
    getAshedConnectionMock.mockResolvedValue({ appId: "app", token: "t" });
    verifyBase44ConnectionMock.mockResolvedValue({ email: "a@b.com" });

    await expect(
      deviceLinkStrategy.onComplete({
        sourceSession: legacySession(),
        targetSessionId: "mobile-sess",
        metadata: {},
        pairingCodeId: "pair-1",
      }),
    ).rejects.toMatchObject({
      code: "NOT_CONNECTED",
    });

    expect(copyMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("copies credentials and registers device when source session is valid", async () => {
    getAshedConnectionMock.mockResolvedValue({ appId: "app", token: "t" });
    verifyBase44ConnectionMock.mockResolvedValue({ email: "a@b.com" });

    await deviceLinkStrategy.onComplete({
      sourceSession: legacySession({ hqUserId: "hq-1" }),
      targetSessionId: "mobile-sess",
      metadata: {},
      pairingCodeId: "pair-1",
      clientInfo: { userAgent: "TestAgent/1.0" },
    });

    expect(copyMock).toHaveBeenCalledWith("desktop-sess", "mobile-sess");
    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hqUserId: "hq-1",
        sessionId: "mobile-sess",
        pairingCodeId: "pair-1",
        userAgent: "TestAgent/1.0",
      }),
    );
  });

  it("surfaces expired desktop tokens as TOKEN_EXPIRED", async () => {
    getAshedConnectionMock.mockResolvedValue({ appId: "app", token: "t" });
    verifyBase44ConnectionMock.mockRejectedValue(new Error("expired"));

    await expect(
      deviceLinkStrategy.onComplete({
        sourceSession: legacySession({ hqUserId: "hq-1" }),
        targetSessionId: "mobile-sess",
        metadata: {},
        pairingCodeId: "pair-1",
      }),
    ).rejects.toBeInstanceOf(PairingError);

    expect(copyMock).not.toHaveBeenCalled();
  });
});
