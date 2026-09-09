import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const denormalizeGameUidOnMember = vi.fn();
const openMemberAllianceTenure = vi.fn();
const syncCommanderIdentityFromMemberLink = vi.fn();

vi.mock("@/lib/members/member-tenure.server", () => ({
  denormalizeGameUidOnMember: (...args: unknown[]) =>
    denormalizeGameUidOnMember(...args),
  openMemberAllianceTenure: (...args: unknown[]) =>
    openMemberAllianceTenure(...args),
}));

vi.mock("@/lib/members/commander-identity.server", () => ({
  syncCommanderIdentityFromMemberLink: (...args: unknown[]) =>
    syncCommanderIdentityFromMemberLink(...args),
}));

/**
 * Drizzle-style chain: every method returns the chain; awaiting resolves to
 * `result`. `limit()` also resolves to `result` for `.limit(1)` call sites.
 */
function selectResult(result: unknown) {
  const terminal = Promise.resolve(result);
  const chain: Record<string, unknown> = {};
  const get = () => chain;
  for (const key of [
    "from",
    "where",
    "leftJoin",
    "innerJoin",
    "orderBy",
    "groupBy",
    "having",
  ]) {
    chain[key] = get;
  }
  chain.limit = () => terminal;
  chain.then = terminal.then.bind(terminal);
  chain.catch = terminal.catch.bind(terminal);
  return chain;
}

describe("linkDiscordMember replaceAll safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("source: does not wipe all seats before occupancy check (bug repro guard)", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "repository.ts"),
      "utf8",
    );
    const start = src.indexOf("export async function linkDiscordMember");
    const end = src.indexOf(
      "/** @deprecated Use linkDiscordMember",
      start,
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);

    // Old bug: `if (replaceAll) await deleteDiscordMemberLinksForUser(...)`
    // ran before getDiscordLinkByAllianceAndMember.
    expect(body).not.toMatch(
      /if\s*\(\s*input\.replaceAll\s*\)\s*\{\s*await\s+deleteDiscordMemberLinksForUser/,
    );

    const occupancyIdx = body.indexOf("getDiscordLinkByAllianceAndMember");
    const firstTxIdx = body.indexOf("db.transaction");
    expect(occupancyIdx).toBeGreaterThanOrEqual(0);
    expect(firstTxIdx).toBeGreaterThan(occupancyIdx);
  });

  it("returns occupied-seat error without deleting when replaceAll target belongs to another Discord user", async () => {
    const transaction = vi.fn();
    const del = vi.fn();
    const insert = vi.fn();
    const update = vi.fn();

    // isGameUidClaimedByOtherDiscordUser → 3 parallel selects (hq link, hq
    // claims, discord claims), then occupancy select, then user-links select.
    const selectQueue = [
      [], // getDiscordHqLink
      [], // hqClaims
      [], // discordClaims
      [{ discordUserId: "other-discord", ashedMemberId: "c-new" }], // occupancy
    ];

    vi.doMock("@/lib/db", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/db")>();
      return {
        ...actual,
        getDb: () => ({
          select: vi.fn(() => selectResult(selectQueue.shift() ?? [])),
          transaction,
          delete: del,
          insert,
          update,
        }),
      };
    });

    const { linkDiscordMember } = await import("./repository");

    const result = await linkDiscordMember({
      allianceId: "alliance-1",
      discordUserId: "discord-alice",
      ashedMemberId: "c-new",
      gameUid: "123456789012",
      replaceAll: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "member_linked_to_other_discord",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(denormalizeGameUidOnMember).not.toHaveBeenCalled();
  });

  it("rolls back replaceAll wipe when insert hits member unique conflict (preserves prior seats)", async () => {
    const uniqueError = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "discord_member_links_alliance_member_unique",
    });

    let deletedInsideTx = false;
    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => ({
          values: () => ({
            returning: async () => {
              throw uniqueError;
            },
          }),
        }),
        delete: () => ({
          where: async () => {
            deletedInsideTx = true;
            return [];
          },
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => [],
            }),
          }),
        }),
      };
      return fn(tx);
    });

    const selectQueue = [
      [], // getDiscordHqLink
      [], // hqClaims
      [], // discordClaims
      [], // occupancy (free)
      [
        {
          id: "link-c1",
          allianceId: "alliance-1",
          discordUserId: "discord-alice",
          ashedMemberId: "c1",
        },
        {
          id: "link-c2",
          allianceId: "alliance-1",
          discordUserId: "discord-alice",
          ashedMemberId: "c2",
        },
      ], // user links
    ];

    vi.doMock("@/lib/db", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/db")>();
      return {
        ...actual,
        getDb: () => ({
          select: vi.fn(() => selectResult(selectQueue.shift() ?? [])),
          transaction,
          delete: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
        }),
      };
    });

    const { linkDiscordMember } = await import("./repository");

    const result = await linkDiscordMember({
      allianceId: "alliance-1",
      discordUserId: "discord-alice",
      ashedMemberId: "c-new",
      gameUid: "123456789012",
      replaceAll: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "member_linked_to_other_discord",
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    // Insert throws before prune delete runs inside the TX.
    expect(deletedInsideTx).toBe(false);
    expect(denormalizeGameUidOnMember).not.toHaveBeenCalled();
  });

  it("happy path: replaceAll inserts target then prunes other seats inside one transaction", async () => {
    const ops: string[] = [];
    const inserted = {
      id: "link-new",
      allianceId: "alliance-1",
      discordUserId: "discord-alice",
      ashedMemberId: "c-new",
      gameUid: "123456789012",
    };

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => ({
          values: () => ({
            returning: async () => {
              ops.push("insert");
              return [inserted];
            },
          }),
        }),
        delete: () => ({
          where: async () => {
            ops.push("delete-others");
            return [];
          },
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => [],
            }),
          }),
        }),
      };
      return fn(tx);
    });

    const selectQueue = [
      [],
      [],
      [],
      [], // occupancy free
      [
        {
          id: "link-c1",
          allianceId: "alliance-1",
          discordUserId: "discord-alice",
          ashedMemberId: "c1",
        },
      ],
    ];

    vi.doMock("@/lib/db", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/db")>();
      return {
        ...actual,
        getDb: () => ({
          select: vi.fn(() => selectResult(selectQueue.shift() ?? [])),
          transaction,
          delete: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
        }),
      };
    });

    const { linkDiscordMember } = await import("./repository");

    const result = await linkDiscordMember({
      allianceId: "alliance-1",
      discordUserId: "discord-alice",
      ashedMemberId: "c-new",
      gameUid: "123456789012",
      memberDisplayName: "NewCo",
      replaceAll: true,
    });

    expect(result).toEqual({
      ok: true,
      link: inserted,
      mode: "replaced",
    });
    expect(ops).toEqual(["insert", "delete-others"]);
    expect(denormalizeGameUidOnMember).toHaveBeenCalled();
    expect(openMemberAllianceTenure).toHaveBeenCalled();
    expect(syncCommanderIdentityFromMemberLink).toHaveBeenCalled();
  });
});
