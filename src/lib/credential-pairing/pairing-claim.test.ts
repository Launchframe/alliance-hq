import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import {
  claimPairingCode,
  completePairing,
  pairingClaimFailure,
} from "./index";
import { PairingError } from "./types";

const strategyCompleteMock = vi.fn();

vi.mock("@/lib/credential-pairing/strategies", () => ({
  getPairingStrategy: () => ({
    onComplete: (...args: unknown[]) => strategyCompleteMock(...args),
  }),
}));

vi.mock("@/lib/session", () => ({
  loadSession: vi.fn(),
}));

import { loadSession } from "@/lib/session";

describe("pairingClaimFailure", () => {
  it("returns INVALID when code row is missing", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const error = await pairingClaimFailure("missing-code");
    expect(error).toMatchObject({ code: "INVALID" });
  });

  it("returns CONSUMED when code was already used", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const error = await pairingClaimFailure("used-code");
    expect(error).toMatchObject({ code: "CONSUMED" });
  });

  it("returns EXPIRED when code TTL elapsed", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        consumedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
      },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const error = await pairingClaimFailure("expired-code");
    expect(error).toMatchObject({ code: "EXPIRED" });
  });
});

describe("claimPairingCode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns claimed row when atomic update succeeds", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: "pair-1",
        purpose: "device_link",
        sourceSessionId: "desktop-sess",
        metadataJson: { note: "x" },
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      update,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const now = new Date("2026-06-15T12:00:00.000Z");
    const row = await claimPairingCode("abc", "mobile-sess", now);

    expect(row).toEqual({
      id: "pair-1",
      purpose: "device_link",
      sourceSessionId: "desktop-sess",
      metadataJson: { note: "x" },
    });
    expect(set).toHaveBeenCalledWith({
      consumedAt: now,
      consumedBySessionId: "mobile-sess",
    });
  });

  it("throws pairingClaimFailure when update claims zero rows", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    const limit = vi.fn().mockResolvedValue([
      {
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const selectWhere = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const select = vi.fn().mockReturnValue({ from });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      update,
      select,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    await expect(claimPairingCode("race-code", "mobile-sess")).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  it("rejects invalid purpose values from the database", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: "pair-1",
        purpose: "unknown_purpose",
        sourceSessionId: "desktop-sess",
        metadataJson: null,
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      update,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    await expect(claimPairingCode("abc", "mobile-sess")).rejects.toMatchObject({
      code: "INVALID",
    });
  });
});

describe("completePairing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    strategyCompleteMock.mockResolvedValue(undefined);
  });

  it("rejects self-pairing before claiming the code", async () => {
    const limit = vi.fn().mockResolvedValue([{ sourceSessionId: "same-sess" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const update = vi.fn();

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select,
      update,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    await expect(completePairing("code-1", "same-sess")).rejects.toMatchObject({
      code: "INVALID",
    });

    expect(update).not.toHaveBeenCalled();
    expect(strategyCompleteMock).not.toHaveBeenCalled();
  });

  it("claims code then runs strategy onComplete", async () => {
    const previewLimit = vi
      .fn()
      .mockResolvedValue([{ sourceSessionId: "desktop-sess" }]);
    const previewWhere = vi.fn().mockReturnValue({ limit: previewLimit });
    const previewFrom = vi.fn().mockReturnValue({ where: previewWhere });

    const returning = vi.fn().mockResolvedValue([
      {
        id: "pair-1",
        purpose: "device_link",
        sourceSessionId: "desktop-sess",
        metadataJson: null,
      },
    ]);
    const claimWhere = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: claimWhere });
    const update = vi.fn().mockReturnValue({ set });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({ from: previewFrom }),
      update,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    vi.mocked(loadSession).mockResolvedValue({
      id: "desktop-sess",
      hqUserId: "hq-1",
      userLabel: null,
      allianceId: null,
      allianceTag: null,
      currentAllianceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await completePairing("code-1", "mobile-sess", {
      clientInfo: { userAgent: "Mobile/1.0" },
    });

    expect(result).toEqual({ ok: true, purpose: "device_link" });
    expect(strategyCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSessionId: "mobile-sess",
        pairingCodeId: "pair-1",
        clientInfo: { userAgent: "Mobile/1.0" },
      }),
    );
  });

  it("throws when source session no longer exists after claim", async () => {
    const previewLimit = vi
      .fn()
      .mockResolvedValue([{ sourceSessionId: "desktop-sess" }]);
    const previewWhere = vi.fn().mockReturnValue({ limit: previewLimit });
    const previewFrom = vi.fn().mockReturnValue({ where: previewWhere });

    const returning = vi.fn().mockResolvedValue([
      {
        id: "pair-1",
        purpose: "device_link",
        sourceSessionId: "desktop-sess",
        metadataJson: null,
      },
    ]);
    const claimWhere = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: claimWhere });
    const update = vi.fn().mockReturnValue({ set });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({ from: previewFrom }),
      update,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    vi.mocked(loadSession).mockResolvedValue(null);

    await expect(completePairing("code-1", "mobile-sess")).rejects.toBeInstanceOf(
      PairingError,
    );
    expect(strategyCompleteMock).not.toHaveBeenCalled();
  });
});
