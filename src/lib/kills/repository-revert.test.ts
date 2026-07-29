import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn());
const updateWhere = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
          orderBy: () => ({
            limit: selectLimit,
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: updateWhere,
      }),
    }),
  }),
  schema: {
    commanders: {
      id: "id",
      currentKills: "currentKills",
      killsUpdatedAt: "killsUpdatedAt",
      primaryName: "primaryName",
    },
    commanderKillsEvents: {
      id: "id",
      commanderId: "commanderId",
      source: "source",
      total: "total",
      previousTotal: "previousTotal",
      discardedAt: "discardedAt",
      createdAt: "createdAt",
    },
  },
}));

import { revertLatestVideoParseKillsIfStillCurrent } from "@/lib/kills/repository";

describe("revertLatestVideoParseKillsIfStillCurrent", () => {
  beforeEach(() => {
    selectLimit.mockReset();
    updateWhere.mockReset();
    updateWhere.mockResolvedValue(undefined);
  });

  it("reverts when latest video_parse event still matches current kills", async () => {
    selectLimit
      .mockResolvedValueOnce([{ currentKills: 2500 }])
      .mockResolvedValueOnce([
        {
          id: "evt-1",
          source: "video_parse",
          total: 2500,
          previousTotal: 2000,
        },
      ]);

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1"),
    ).resolves.toBe(true);
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });

  it("reverts when expectedTotal matches current kills and latest event", async () => {
    selectLimit
      .mockResolvedValueOnce([{ currentKills: 2500 }])
      .mockResolvedValueOnce([
        {
          id: "evt-1",
          source: "video_parse",
          total: 2500,
          previousTotal: 2000,
        },
      ]);

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1", 2500),
    ).resolves.toBe(true);
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });

  it("skips revert when expectedTotal differs from a newer event total", async () => {
    selectLimit
      .mockResolvedValueOnce([{ currentKills: 3000 }])
      .mockResolvedValueOnce([
        {
          id: "evt-newer",
          source: "video_parse",
          total: 3000,
          previousTotal: 2500,
        },
      ]);

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1", 2500),
    ).resolves.toBe(false);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("skips revert when expectedTotal matches latest event but current kills moved on", async () => {
    selectLimit
      .mockResolvedValueOnce([{ currentKills: 3000 }])
      .mockResolvedValueOnce([
        {
          id: "evt-1",
          source: "video_parse",
          total: 2500,
          previousTotal: 2000,
        },
      ]);

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1", 2500),
    ).resolves.toBe(false);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("skips revert when latest event is not video_parse", async () => {
    selectLimit
      .mockResolvedValueOnce([{ currentKills: 2500 }])
      .mockResolvedValueOnce([
        {
          id: "evt-web",
          source: "web",
          total: 2500,
          previousTotal: 2000,
        },
      ]);

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1", 2500),
    ).resolves.toBe(false);
    expect(updateWhere).not.toHaveBeenCalled();
  });
});
