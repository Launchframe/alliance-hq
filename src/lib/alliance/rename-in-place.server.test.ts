import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  byServerAndTag: vi.fn(),
  byAllianceId: vi.fn(),
}));

vi.mock("@/lib/lastrank/sync-registry.shared", () => ({
  lookupLastRankSyncByServerAndTag: mocks.byServerAndTag,
  lookupLastRankSyncByAllianceId: mocks.byAllianceId,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  }),
  schema: {
    alliances: {
      id: "id",
      tag: "tag",
      name: "name",
      slug: "slug",
      gameServerNumber: "game_server_number",
      lastrankAllianceId: "lastrank_alliance_id",
    },
    sessions: {},
    auditLog: {},
  },
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/native-alliance/provision", () => ({
  slugifyNativeAlliance: () => "slug",
}));

import { resolveLastRankPin } from "./rename-in-place.server";

describe("resolveLastRankPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.byServerAndTag.mockReturnValue(null);
    mocks.byAllianceId.mockReturnValue(null);
  });

  it("treats explicit null as an unpin", () => {
    expect(
      resolveLastRankPin({
        gameServerNumber: 1211,
        previousTag: "Old",
        nextTag: "New",
        existingPin: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        explicitPin: null,
      }),
    ).toBeNull();
    expect(mocks.byServerAndTag).not.toHaveBeenCalled();
  });

  it("keeps the existing pin when the field is omitted", () => {
    expect(
      resolveLastRankPin({
        gameServerNumber: 1211,
        previousTag: "Old",
        nextTag: "New",
        existingPin: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        explicitPin: undefined,
      }),
    ).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("prefers the previous-tag registry entry over the new tag", () => {
    mocks.byServerAndTag.mockImplementation(
      (_server: number, tag: string) => {
        if (tag === "Old") {
          return {
            lastrankAllianceId: "cccccccccccccccccccccccccccccccc",
            tag: "Old",
          };
        }
        if (tag === "New") {
          return {
            lastrankAllianceId: "dddddddddddddddddddddddddddddddd",
            tag: "New",
          };
        }
        return null;
      },
    );

    expect(
      resolveLastRankPin({
        gameServerNumber: 1211,
        previousTag: "Old",
        nextTag: "New",
        existingPin: null,
        explicitPin: undefined,
      }),
    ).toBe("cccccccccccccccccccccccccccccccc");
  });

  it("falls back to the new-tag registry when the previous tag is unmapped", () => {
    mocks.byServerAndTag.mockImplementation(
      (_server: number, tag: string) => {
        if (tag === "New") {
          return {
            lastrankAllianceId: "dddddddddddddddddddddddddddddddd",
            tag: "New",
          };
        }
        return null;
      },
    );

    expect(
      resolveLastRankPin({
        gameServerNumber: 1211,
        previousTag: "Old",
        nextTag: "New",
        existingPin: null,
        explicitPin: undefined,
      }),
    ).toBe("dddddddddddddddddddddddddddddddd");
  });
});
