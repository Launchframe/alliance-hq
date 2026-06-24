import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";

import { resolveAllianceGameServerNumber } from "./game-servers.server";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    alliances: {
      id: "id",
      gameServerId: "game_server_id",
      gameServerNumber: "game_server_number",
    },
    gameServers: {
      id: "id",
      serverNumber: "server_number",
    },
  },
}));

function dbSelectChain(result: unknown) {
  return {
    from: () => ({
      leftJoin: () => ({
        where: () => ({
          limit: () => Promise.resolve(result),
        }),
      }),
    }),
  };
}

describe("resolveAllianceGameServerNumber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when alliance has denormalized number but no game_server_id link", async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() =>
        dbSelectChain([
          {
            gameServerId: null,
            gameServerNumber: 1203,
            serverNumber: null,
          },
        ]),
      ),
    } as never);

    await expect(resolveAllianceGameServerNumber("alliance-1")).resolves.toBeNull();
  });

  it("returns joined server number when game_server_id is set", async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() =>
        dbSelectChain([
          {
            gameServerId: "server-1203",
            gameServerNumber: 1203,
            serverNumber: 1203,
          },
        ]),
      ),
    } as never);

    await expect(resolveAllianceGameServerNumber("alliance-1")).resolves.toBe(1203);
  });

  it("returns null when game_server_id is set but join row is missing", async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() =>
        dbSelectChain([
          {
            gameServerId: "server-1203",
            gameServerNumber: 1203,
            serverNumber: null,
          },
        ]),
      ),
    } as never);

    await expect(resolveAllianceGameServerNumber("alliance-1")).resolves.toBeNull();
  });
});
