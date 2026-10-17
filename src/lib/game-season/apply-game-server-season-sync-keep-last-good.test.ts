import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  serverRow: null as null | {
    seasonKeyOverride: string | null;
    openTimestampMs: number | null;
    seasonKeySynced: string | null;
    seasonKeySource: string | null;
    seasonIsPostSeason: number;
    seasonWeek: number | null;
  },
  updates: [] as Record<string, unknown>[],
  mirrored: [] as Record<string, unknown>[],
  fetchRecord: vi.fn(),
  ensureSeason: vi.fn(async (n: number) => `season-${n}`),
  syncShiny: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/game-season/cpt-hedge", () => ({
  fetchCptHedgeServerRecord: (
    serverNumber: number,
    forceRefresh?: boolean,
  ) => state.fetchRecord(serverNumber, forceRefresh),
}));
vi.mock("@/lib/game-season/game-servers.server", () => ({
  ensureGameSeason: (seasonNumber: number) => state.ensureSeason(seasonNumber),
  mirrorServerSeasonToAlliances: async (
    _id: string,
    patch: Record<string, unknown>,
  ) => {
    state.mirrored.push(patch);
  },
  upsertGameServerByNumber: vi.fn(),
  linkAllianceToGameServer: vi.fn(),
}));
vi.mock("@/lib/vs-calculator/shiny-sync.server", () => ({
  syncShinySpawnWeekdaysForGameServer: (
    gameServerId: string,
    openTimestampMs: number,
  ) => state.syncShiny(gameServerId, openTimestampMs),
}));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => (state.serverRow ? [state.serverRow] : []),
  };
  return {
    schema,
    getDb: () => ({
      select: () => selectChain,
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.updates.push(values);
          return {
            where: async () => undefined,
          };
        },
      }),
    }),
  };
});

import { applyGameServerSeasonSync } from "@/lib/game-season/sync";

describe("applyGameServerSeasonSync keep-last-good cpt-hedge", () => {
  beforeEach(() => {
    state.updates = [];
    state.mirrored = [];
    state.fetchRecord.mockReset();
    state.ensureSeason.mockClear();
    state.syncShiny.mockReset();
    state.serverRow = {
      seasonKeyOverride: null,
      openTimestampMs: 1_735_204_501_000,
      seasonKeySynced: "5",
      seasonKeySource: "cpt-hedge",
      seasonIsPostSeason: 0,
      seasonWeek: 3,
    };
  });

  it("does not age-fallback stomp S5 when cpt-hedge miss (empty/parse fail)", async () => {
    state.fetchRecord.mockResolvedValueOnce(null);

    const effective = await applyGameServerSeasonSync("gs-1203", 1203);

    expect(effective).toEqual({
      seasonKey: "5",
      source: "cpt-hedge",
      isPostSeason: false,
      week: 3,
      gameServerNumber: 1203,
    });
    // RED without keep-last-good: updates + mirror would write seasonKey "4" /
    // source age-fallback and clear week/post-season for all alliances.
    expect(state.updates).toHaveLength(0);
    expect(state.mirrored).toHaveLength(0);
  });

  it("does not clear post-season when cpt-hedge throws after a good sync", async () => {
    state.serverRow = {
      seasonKeyOverride: null,
      openTimestampMs: 1_735_204_501_000,
      seasonKeySynced: "4",
      seasonKeySource: "cpt-hedge",
      seasonIsPostSeason: 1,
      seasonWeek: 12,
    };
    state.fetchRecord.mockRejectedValueOnce(new Error("cpt-hedge fetch failed"));

    const effective = await applyGameServerSeasonSync("gs-1203", 1203);

    expect(effective.isPostSeason).toBe(true);
    expect(effective.seasonKey).toBe("4");
    expect(effective.source).toBe("cpt-hedge");
    expect(state.updates).toHaveLength(0);
    expect(state.mirrored).toHaveLength(0);
  });

  it("still age-falls back when there was no prior cpt-hedge sync", async () => {
    state.serverRow = {
      seasonKeyOverride: null,
      openTimestampMs: 1_735_204_501_000,
      seasonKeySynced: "1",
      seasonKeySource: "default",
      seasonIsPostSeason: 0,
      seasonWeek: null,
    };
    state.fetchRecord.mockResolvedValueOnce(null);

    const effective = await applyGameServerSeasonSync("gs-1203", 1203);

    expect(effective.source).toBe("age-fallback");
    expect(Number.parseInt(effective.seasonKey, 10)).toBeLessThanOrEqual(4);
    expect(state.mirrored).toHaveLength(1);
    expect(state.mirrored[0]).toMatchObject({
      seasonKeySource: "age-fallback",
      seasonIsPostSeason: 0,
    });
  });
});
