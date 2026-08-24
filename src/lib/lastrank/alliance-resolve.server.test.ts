import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<{
    id: string;
    tag: string | null;
    name: string;
    gameServerNumber: number;
  }>,
  createNativeAlliance: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mocks.selectResult),
      }),
    }),
  }),
  schema: {
    alliances: {
      id: "id",
      tag: "tag",
      name: "name",
      gameServerNumber: "game_server_number",
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
    mocks.createNativeAlliance.mockResolvedValue({ allianceId: "new-alliance" });
  });

  it("uses a sole fuzzy tag match on apply instead of creating a duplicate", async () => {
    mocks.selectResult = [
      {
        id: "hq-existing",
        tag: "LFg0",
        name: "LFgo Alliance",
        gameServerNumber: 1203,
      },
    ];

    const result = await resolveHqAllianceForLastRankSync({
      target: {
        gameServerNumber: 1203,
        tag: "LFgo",
        lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
      },
      allowCreate: true,
    });

    expect(result).toEqual({ allianceId: "hq-existing", created: false });
    expect(mocks.createNativeAlliance).not.toHaveBeenCalled();
  });

  it("creates a native alliance when no exact or fuzzy match exists and apply is set", async () => {
    mocks.selectResult = [];

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
