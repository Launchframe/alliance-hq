import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectLimit, selectForUpdate, updateWhere, transaction, makeTx } = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectForUpdate = vi.fn();
  const updateWhere = vi.fn();
  const makeTx = () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: selectForUpdate,
          }),
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
  });
  const transaction = vi.fn((work: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
    work(makeTx()),
  );
  return { selectLimit, selectForUpdate, updateWhere, transaction, makeTx };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction,
  }),
  schema: {
    commanders: {
      id: "id",
      currentKills: "currentKills",
      killsUpdatedAt: "killsUpdatedAt",
      primaryName: "primaryName",
      updatedAt: "updatedAt",
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
    selectForUpdate.mockReset();
    updateWhere.mockReset();
    updateWhere.mockResolvedValue(undefined);
    transaction.mockClear();
    transaction.mockImplementation((work) => work(makeTx()));
  });

  function mockHappyPath() {
    selectForUpdate.mockResolvedValueOnce([{ currentKills: 2500 }]);
    selectLimit.mockResolvedValueOnce([
      {
        id: "evt-1",
        source: "video_parse",
        total: 2500,
        previousTotal: 2000,
      },
    ]);
  }

  it("runs inside a transaction and locks the commander before tip checks", async () => {
    const order: string[] = [];
    transaction.mockImplementationOnce(async (work) => {
      order.push("tx");
      return work({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => {
                order.push("commander-select");
                return {
                  for: async () => {
                    order.push("commander-for-update");
                    return [{ currentKills: 2500 }];
                  },
                };
              },
              orderBy: () => ({
                limit: async () => {
                  order.push("event-tip");
                  return [
                    {
                      id: "evt-1",
                      source: "video_parse",
                      total: 2500,
                      previousTotal: 2000,
                    },
                  ];
                },
              }),
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: async () => {
              order.push("update");
              return undefined;
            },
          }),
        }),
      } as unknown as ReturnType<typeof makeTx>);
    });

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1", 2500),
    ).resolves.toBe(true);
    expect(order).toEqual([
      "tx",
      "commander-select",
      "commander-for-update",
      "event-tip",
      "update",
      "update",
    ]);
  });

  it("reverts when latest video_parse event still matches current kills", async () => {
    mockHappyPath();

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1"),
    ).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });

  it("reverts when expectedTotal matches current kills and latest event", async () => {
    mockHappyPath();

    await expect(
      revertLatestVideoParseKillsIfStillCurrent("cmd-1", 2500),
    ).resolves.toBe(true);
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });

  it("skips revert when expectedTotal differs from a newer event total", async () => {
    selectForUpdate.mockResolvedValueOnce([{ currentKills: 3000 }]);
    selectLimit.mockResolvedValueOnce([
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
    selectForUpdate.mockResolvedValueOnce([{ currentKills: 3000 }]);
    selectLimit.mockResolvedValueOnce([
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
    selectForUpdate.mockResolvedValueOnce([{ currentKills: 2500 }]);
    selectLimit.mockResolvedValueOnce([
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

  it("documents the pre-fix TOCTOU: unlocked tip check then restore can clobber a newer total", () => {
    // Concurrent upsert lands 3000 after an unlocked read of tip=2500 / current=2500.
    // Old revert would still discard evt-1 and write previousTotal=2000 onto commanders.
    const tipAtCheck = { total: 2500, previousTotal: 2000, source: "video_parse" };
    const currentAtCheck = 2500;
    const currentAfterConcurrentUpsert = 3000;
    const wouldClobber =
      tipAtCheck.source === "video_parse" &&
      currentAtCheck === tipAtCheck.total &&
      currentAfterConcurrentUpsert !== tipAtCheck.previousTotal;
    expect(wouldClobber).toBe(true);
  });
});
