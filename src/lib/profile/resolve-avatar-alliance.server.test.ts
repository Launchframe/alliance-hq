import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { refreshCommanderGameAvatarIfStale, updateSet } = vi.hoisted(() => ({
  refreshCommanderGameAvatarIfStale: vi.fn(),
  updateSet: vi.fn().mockResolvedValue(undefined),
}));

type SelectKind = "user" | "providers" | "linked" | "unknown";

let nextSelects: Array<{ kind: SelectKind; rows: unknown[] }> = [];

vi.mock("@/lib/db", () => {
  function selectChain(kind: SelectKind) {
    const chain: Record<string, unknown> = {};
    const finish = () => {
      const next = nextSelects.shift();
      if (!next) return Promise.resolve([]);
      return Promise.resolve(next.rows);
    };
    chain.from = () => chain;
    chain.where = () => chain;
    chain.innerJoin = () => chain;
    chain.leftJoin = () => chain;
    chain.limit = () => finish();
    // loadAuthProviders has no limit — await the thenable chain
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      finish().then(resolve, reject);
    void kind;
    return chain;
  }

  return {
    getDb: () => ({
      select: () => {
        const peek = nextSelects[0]?.kind ?? "unknown";
        return selectChain(peek);
      },
      update: () => ({
        set: (values: unknown) => {
          updateSet(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        },
      }),
    }),
    schema: {
      hqUsers: {
        id: "id",
        avatarUrl: "avatarUrl",
        avatarSource: "avatarSource",
        avatarRefreshedAt: "avatarRefreshedAt",
        updatedAt: "updatedAt",
      },
      hqUserAuthProviders: {
        hqUserId: "hqUserId",
        provider: "provider",
        avatarUrl: "avatarUrl",
      },
      hqMemberLinks: {
        hqUserId: "hqUserId",
        allianceId: "allianceId",
        ashedMemberId: "ashedMemberId",
      },
      commanderAllianceMemberships: {
        allianceId: "allianceId",
        ashedMemberId: "ashedMemberId",
        commanderId: "commanderId",
      },
      commanders: {
        id: "id",
        gameUid: "gameUid",
        gameAvatarUrl: "gameAvatarUrl",
        gameAvatarRefreshedAt: "gameAvatarRefreshedAt",
      },
    },
  };
});

vi.mock("@/lib/commanders/game-avatar.server", () => ({
  refreshCommanderGameAvatarIfStale,
}));

import {
  ensureHqUserAvatarFresh,
  resolveAndCacheHqUserAvatar,
} from "@/lib/profile/resolve-avatar";

describe("alliance-scoped Last War avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextSelects = [];
  });

  it("uses the commander linked in the selected alliance", async () => {
    nextSelects = [
      {
        kind: "user",
        rows: [
          {
            id: "hq-1",
            avatarUrl: null,
            avatarSource: null,
            avatarRefreshedAt: null,
          },
        ],
      },
      { kind: "providers", rows: [] },
      {
        kind: "linked",
        rows: [
          {
            commanderId: "cmd-a",
            gameUid: "1001369694001249",
            gameAvatarUrl: "https://lastwar-h5.lastwargame.com/a.png",
            gameAvatarRefreshedAt: new Date(),
          },
        ],
      },
    ];
    refreshCommanderGameAvatarIfStale.mockResolvedValue(
      "https://lastwar-h5.lastwargame.com/a.png",
    );

    const resolved = await resolveAndCacheHqUserAvatar("hq-1", {
      allianceId: "alliance-a",
    });
    expect(resolved).toEqual({
      avatarUrl: "https://lastwar-h5.lastwargame.com/a.png",
      avatarSource: "lastwar",
    });
    expect(refreshCommanderGameAvatarIfStale).toHaveBeenCalledWith(
      expect.objectContaining({ commanderId: "cmd-a" }),
    );
  });

  it("returns null when no alliance is selected", async () => {
    nextSelects = [
      {
        kind: "user",
        rows: [
          {
            id: "hq-1",
            avatarUrl: "https://stale.example/x.png",
            avatarSource: "lastwar",
            avatarRefreshedAt: new Date(),
          },
        ],
      },
      { kind: "providers", rows: [] },
    ];

    const resolved = await resolveAndCacheHqUserAvatar("hq-1", {
      allianceId: null,
    });
    expect(resolved).toEqual({ avatarUrl: null, avatarSource: null });
    expect(refreshCommanderGameAvatarIfStale).not.toHaveBeenCalled();
  });

  it("ensureHqUserAvatarFresh prefers Google over alliance Last War", async () => {
    nextSelects = [
      {
        kind: "providers",
        rows: [
          {
            provider: "google",
            avatarUrl: "https://lh3.googleusercontent.com/g",
          },
        ],
      },
    ];

    const url = await ensureHqUserAvatarFresh(
      {
        id: "hq-1",
        avatarUrl: null,
        avatarSource: null,
        avatarRefreshedAt: null,
      } as never,
      "alliance-a",
    );
    expect(url).toBe("https://lh3.googleusercontent.com/g");
    expect(refreshCommanderGameAvatarIfStale).not.toHaveBeenCalled();
  });

  it("returns null when the selected alliance has no linked commander", async () => {
    nextSelects = [
      {
        kind: "user",
        rows: [
          {
            id: "hq-1",
            avatarUrl: null,
            avatarSource: null,
            avatarRefreshedAt: null,
          },
        ],
      },
      { kind: "providers", rows: [] },
      { kind: "linked", rows: [] },
    ];

    const resolved = await resolveAndCacheHqUserAvatar("hq-1", {
      allianceId: "alliance-b",
    });
    expect(resolved).toEqual({ avatarUrl: null, avatarSource: null });
    expect(refreshCommanderGameAvatarIfStale).not.toHaveBeenCalled();
  });
});
