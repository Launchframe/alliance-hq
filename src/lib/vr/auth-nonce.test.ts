import { beforeEach, describe, expect, it, vi } from "vitest";

const returningMock = vi.fn();
const whereUpdateMock = vi.fn();
const setUpdateMock = vi.fn(() => ({ where: whereUpdateMock }));
const updateMock = vi.fn(() => ({ set: setUpdateMock }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: updateMock,
    select: vi.fn(),
    insert: vi.fn(),
  }),
  schema: {
    discordAuthNonces: {
      id: "id",
      nonce: "nonce",
      expiresAt: "expires_at",
      usedAt: "used_at",
    },
  },
}));

import {
  claimDiscordAuthNonce,
  consumeDiscordAuthNonce,
  releaseDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";

describe("discord auth nonce claim/release", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whereUpdateMock.mockImplementation(() => {
      const result = Promise.resolve(undefined) as Promise<unknown> & {
        returning: typeof returningMock;
      };
      result.returning = returningMock;
      return result;
    });
  });

  it("claimDiscordAuthNonce returns the row when CAS update wins", async () => {
    const row = {
      id: "nonce-1",
      nonce: "abc",
      discordUserId: "discord-1",
      tag: "lfgo",
      purpose: "alliance_credentials",
    };
    returningMock.mockResolvedValue([row]);

    await expect(claimDiscordAuthNonce("abc")).resolves.toEqual(row);
    expect(setUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ usedAt: expect.any(Date) }),
    );
  });

  it("claimDiscordAuthNonce returns null when another redeemer already claimed", async () => {
    returningMock.mockResolvedValue([]);
    await expect(claimDiscordAuthNonce("abc")).resolves.toBeNull();
  });

  it("releaseDiscordAuthNonce clears usedAt for retry after failed side effects", async () => {
    await releaseDiscordAuthNonce("nonce-1");
    expect(setUpdateMock).toHaveBeenCalledWith({ usedAt: null });
  });

  it("consumeDiscordAuthNonce still updates by id", async () => {
    await consumeDiscordAuthNonce("nonce-1");
    expect(setUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ usedAt: expect.any(Date) }),
    );
  });
});
