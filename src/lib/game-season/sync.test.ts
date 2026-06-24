import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyGameServerSeasonSync } from "@/lib/game-season/sync";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    alliances: {
      id: "id",
      currentSeasonKey: "currentSeasonKey",
      gameServerNumber: "gameServerNumber",
      gameServerOpenTimestamp: "gameServerOpenTimestamp",
      seasonKeyOverride: "seasonKeyOverride",
      seasonKeySynced: "seasonKeySynced",
      seasonKeySource: "seasonKeySource",
      seasonSyncedAt: "seasonSyncedAt",
      seasonIsPostSeason: "seasonIsPostSeason",
      seasonWeek: "seasonWeek",
      gameServerId: "gameServerId",
      updatedAt: "updatedAt",
    },
    gameServers: {
      id: "id",
      seasonKeyOverride: "seasonKeyOverride",
      openTimestampMs: "openTimestampMs",
      seasonId: "seasonId",
      seasonKeySource: "seasonKeySource",
      seasonKeySynced: "seasonKeySynced",
      seasonIsPostSeason: "seasonIsPostSeason",
      seasonWeek: "seasonWeek",
      syncedAt: "syncedAt",
      updatedAt: "updatedAt",
    },
  },
}));

vi.mock("@/lib/game-season/cpt-hedge", () => ({
  fetchCptHedgeServerRecord: vi.fn(),
}));

vi.mock("@/lib/game-season/game-servers.server", () => ({
  ensureGameSeason: vi.fn().mockResolvedValue("season-1"),
  mirrorServerSeasonToAlliances: vi.fn().mockResolvedValue(undefined),
}));

function mockDbForServerRow(
  row: {
    seasonKeyOverride: string | null;
    openTimestampMs: number | null;
  } | null,
) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(row ? [row] : []),
        }),
      }),
    }),
    update,
    _updateWhere: updateWhere,
  };
}

describe("applyGameServerSeasonSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when game server row is missing", async () => {
    const db = await import("@/lib/db");
    vi.mocked(db.getDb).mockReturnValue(
      mockDbForServerRow(null) as never,
    );

    await expect(
      applyGameServerSeasonSync("server-missing", 1203),
    ).rejects.toThrow("Game server not found: server-missing");
  });

  it("uses server season override and mirrors to alliances", async () => {
    const db = await import("@/lib/db");
    const servers = await import("@/lib/game-season/game-servers.server");
    vi.mocked(db.getDb).mockReturnValue(
      mockDbForServerRow({
        seasonKeyOverride: "5",
        openTimestampMs: null,
      }) as never,
    );
    vi.mocked(servers.ensureGameSeason).mockResolvedValue("season-5");

    const result = await applyGameServerSeasonSync("server-1203", 1203);

    expect(result).toMatchObject({
      seasonKey: "5",
      source: "override",
      gameServerNumber: 1203,
    });
    expect(servers.ensureGameSeason).toHaveBeenCalledWith(5);
    expect(servers.mirrorServerSeasonToAlliances).toHaveBeenCalledWith(
      "server-1203",
      expect.objectContaining({
        currentSeasonKey: "5",
        seasonKeySource: "override",
      }),
    );
  });

  it("falls back to default season when no override, cpt-hedge, or open timestamp", async () => {
    const db = await import("@/lib/db");
    const cpt = await import("@/lib/game-season/cpt-hedge");
    const servers = await import("@/lib/game-season/game-servers.server");
    vi.mocked(db.getDb).mockReturnValue(
      mockDbForServerRow({
        seasonKeyOverride: null,
        openTimestampMs: null,
      }) as never,
    );
    vi.mocked(cpt.fetchCptHedgeServerRecord).mockResolvedValue(null);

    const result = await applyGameServerSeasonSync("server-1203", 1203);

    expect(result).toMatchObject({
      seasonKey: "1",
      source: "default",
      gameServerNumber: 1203,
    });
    expect(servers.ensureGameSeason).toHaveBeenCalledWith(1);
    expect(servers.mirrorServerSeasonToAlliances).toHaveBeenCalledWith(
      "server-1203",
      expect.objectContaining({
        currentSeasonKey: "1",
        seasonKeySource: "default",
      }),
    );
  });
});
