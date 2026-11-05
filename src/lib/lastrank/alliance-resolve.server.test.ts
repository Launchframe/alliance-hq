import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<{
    id: string;
    tag: string | null;
    name: string;
    gameServerNumber: number;
  }>,
  /** FIFO results for `.limit(1)` selects (pin lookup, then stamp existing-pin). */
  pinSelectQueue: [] as Array<
    Array<{ id?: string; lastrankAllianceId?: string | null }>
  >,
  createNativeAlliance: vi.fn(),
  updateCalls: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          // Pin lookup / stamp existing-pin use limit(1); candidate list awaits where().
          limit: () =>
            Promise.resolve(mocks.pinSelectQueue.shift() ?? []),
          then: (
            resolve: (value: typeof mocks.selectResult) => unknown,
          ) => resolve(mocks.selectResult),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          mocks.updateCalls.push(values);
          return Promise.resolve();
        },
      }),
    }),
  }),
  schema: {
    alliances: {
      id: "id",
      tag: "tag",
      name: "name",
      gameServerNumber: "game_server_number",
      lastrankAllianceId: "lastrank_alliance_id",
      updatedAt: "updated_at",
    },
  },
}));

vi.mock("@/lib/native-alliance/provision", () => ({
  createNativeAlliance: mocks.createNativeAlliance,
}));

import { resolveHqAllianceForLastRankSync } from "./alliance-resolve.server";

describe("resolveHqAllianceForLastRankSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResult = [];
    mocks.pinSelectQueue = [];
    mocks.updateCalls = [];
    mocks.createNativeAlliance.mockResolvedValue({ allianceId: "new-alliance" });
  });

  it("prefers an HQ alliance pinned by lastrankAllianceId over tag matching", async () => {
    mocks.pinSelectQueue = [[{ id: "hq-pinned" }]];
    mocks.selectResult = [
      {
        id: "hq-other",
        tag: "FUze",
        name: "Short Fuse",
        gameServerNumber: 1211,
      },
    ];

    const result = await resolveHqAllianceForLastRankSync({
      target: {
        gameServerNumber: 1211,
        tag: "FUze",
        lastrankAllianceId: "b1cf340c642947579ccbb753e7410c37",
      },
      allowCreate: false,
    });

    expect(result).toEqual({ allianceId: "hq-pinned", created: false });
    expect(mocks.createNativeAlliance).not.toHaveBeenCalled();
  });

  it("refuses non-interactive sole fuzzy tag bind (cron must not hit the wrong alliance)", async () => {
    mocks.selectResult = [
      {
        id: "hq-existing",
        tag: "LFg0",
        name: "LFgo Alliance",
        gameServerNumber: 1203,
      },
    ];

    await expect(
      resolveHqAllianceForLastRankSync({
        target: {
          gameServerNumber: 1203,
          tag: "LFgo",
          lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
        },
        allowCreate: true,
      }),
    ).rejects.toThrow(/No exact HQ tag match.*LFg0/);
    expect(mocks.createNativeAlliance).not.toHaveBeenCalled();
  });

  it("lets interactive prompt accept a fuzzy candidate and stamps the LastRank pin", async () => {
    mocks.selectResult = [
      {
        id: "hq-existing",
        tag: "LFg0",
        name: "LFgo Alliance",
        gameServerNumber: 1203,
      },
    ];
    // find-by-pin → empty; stamp existing-pin → null (ok to stamp)
    mocks.pinSelectQueue = [[], [{ lastrankAllianceId: null }]];

    const result = await resolveHqAllianceForLastRankSync({
      target: {
        gameServerNumber: 1203,
        tag: "LFgo",
        lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
      },
      allowCreate: true,
      alliancePrompt: async () => "hq-existing",
    });

    expect(result).toEqual({ allianceId: "hq-existing", created: false });
    expect(mocks.createNativeAlliance).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toContainEqual(
      expect.objectContaining({
        lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
      }),
    );
  });

  it("refuses fallback stamp when the candidate already has a different pin", async () => {
    mocks.selectResult = [
      {
        id: "hq-existing",
        tag: "FUze",
        name: "Short Fuse",
        gameServerNumber: 1211,
      },
    ];
    mocks.pinSelectQueue = [
      [],
      [{ lastrankAllianceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
    ];

    await expect(
      resolveHqAllianceForLastRankSync({
        target: {
          gameServerNumber: 1211,
          tag: "FUze",
          lastrankAllianceId: "b1cf340c642947579ccbb753e7410c37",
        },
        allowCreate: false,
      }),
    ).rejects.toThrow(/already pinned to a different LastRank id/);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("creates a native alliance when no exact or fuzzy match exists and apply is set", async () => {
    mocks.selectResult = [];
    // find-by-pin empty; stamp on created alliance (null pin)
    mocks.pinSelectQueue = [[], [{ lastrankAllianceId: null }]];

    const result = await resolveHqAllianceForLastRankSync({
      target: {
        gameServerNumber: 1203,
        tag: "NewTag",
        lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
      },
      allowCreate: true,
    });

    expect(result).toEqual({ allianceId: "new-alliance", created: true });
    expect(mocks.createNativeAlliance).toHaveBeenCalledWith({
      name: "NewTag",
      tag: "NewTag",
      gameServerNumber: 1203,
    });
  });
});
