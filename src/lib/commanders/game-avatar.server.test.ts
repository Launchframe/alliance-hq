import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { lookupPlayerByUid, updatePayloads } = vi.hoisted(() => ({
  lookupPlayerByUid: vi.fn(),
  updatePayloads: [] as unknown[],
}));

vi.mock("@/lib/lastwar/player-lookup.server", () => ({
  lookupPlayerByUid,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: unknown) => {
        updatePayloads.push(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    }),
  }),
  schema: {
    commanders: {
      id: "id",
      gameUid: "gameUid",
      gameAvatarUrl: "gameAvatarUrl",
      gameAvatarRefreshedAt: "gameAvatarRefreshedAt",
      updatedAt: "updatedAt",
    },
    commanderAllianceMemberships: {
      allianceId: "allianceId",
      commanderId: "commanderId",
      leftAt: "leftAt",
    },
  },
}));

import {
  refreshCommanderGameAvatarIfStale,
  writeCommanderGameAvatar,
} from "@/lib/commanders/game-avatar.server";

const VALID_UID = "1001369694001249";

describe("writeCommanderGameAvatar", () => {
  beforeEach(() => {
    updatePayloads.length = 0;
  });

  it("persists a non-empty portrait URL", async () => {
    await writeCommanderGameAvatar({
      commanderId: "cmd-1",
      avatarUrl: "https://lastwar-h5.lastwargame.com/p.png",
    });
    expect(updatePayloads[0]).toEqual(
      expect.objectContaining({
        gameAvatarUrl: "https://lastwar-h5.lastwargame.com/p.png",
        gameAvatarRefreshedAt: expect.any(Date),
      }),
    );
  });

  it("clears the portrait when clearMissing is set", async () => {
    await writeCommanderGameAvatar({
      commanderId: "cmd-1",
      avatarUrl: null,
      clearMissing: true,
    });
    expect(updatePayloads[0]).toEqual(
      expect.objectContaining({
        gameAvatarUrl: null,
        gameAvatarRefreshedAt: expect.any(Date),
      }),
    );
  });

  it("bumps refreshed_at only when lookup failed without clearMissing", async () => {
    await writeCommanderGameAvatar({
      commanderId: "cmd-1",
      avatarUrl: null,
    });
    expect(updatePayloads[0]).toEqual({
      gameAvatarRefreshedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(updatePayloads[0]).not.toHaveProperty("gameAvatarUrl");
  });
});

describe("refreshCommanderGameAvatarIfStale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePayloads.length = 0;
  });

  it("returns cached URL when still fresh", async () => {
    const cached = "https://lastwar-h5.lastwargame.com/cached.png";
    const result = await refreshCommanderGameAvatarIfStale({
      commanderId: "cmd-1",
      gameUid: VALID_UID,
      gameAvatarUrl: cached,
      gameAvatarRefreshedAt: new Date(),
    });
    expect(result).toBe(cached);
    expect(lookupPlayerByUid).not.toHaveBeenCalled();
  });

  it("stores a new portrait on a successful lookup", async () => {
    lookupPlayerByUid.mockResolvedValue({
      ok: true,
      avatarUrl: "https://lastwar-h5.lastwargame.com/new.png",
    });
    const result = await refreshCommanderGameAvatarIfStale({
      commanderId: "cmd-1",
      gameUid: VALID_UID,
      gameAvatarUrl: null,
      gameAvatarRefreshedAt: null,
    });
    expect(result).toBe("https://lastwar-h5.lastwargame.com/new.png");
    expect(lookupPlayerByUid).toHaveBeenCalledWith(VALID_UID);
    expect(updatePayloads[0]).toEqual(
      expect.objectContaining({
        gameAvatarUrl: "https://lastwar-h5.lastwargame.com/new.png",
      }),
    );
  });

  it("keeps the prior URL when the lookup is not ok", async () => {
    const cached = "https://lastwar-h5.lastwargame.com/keep.png";
    lookupPlayerByUid.mockResolvedValue({ ok: false });
    const result = await refreshCommanderGameAvatarIfStale({
      commanderId: "cmd-1",
      gameUid: VALID_UID,
      gameAvatarUrl: cached,
      gameAvatarRefreshedAt: null,
    });
    expect(result).toBe(cached);
    expect(updatePayloads[0]).not.toHaveProperty("gameAvatarUrl");
  });

  it("skips network for invalid UIDs", async () => {
    const result = await refreshCommanderGameAvatarIfStale({
      commanderId: "cmd-1",
      gameUid: "abc",
      gameAvatarUrl: null,
      gameAvatarRefreshedAt: null,
    });
    expect(result).toBeNull();
    expect(lookupPlayerByUid).not.toHaveBeenCalled();
  });
});