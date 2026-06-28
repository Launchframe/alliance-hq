import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import { getLinkedMemberIds } from "@/lib/vr/repository";

import { AllianceServerRequiredError } from "./alliance-server-gate.server";
import {
  createHqClaimInvitesBulk,
  createHqInvite,
  type CommanderClaimInviteError,
} from "./invites";

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

function dbSelectChain(result: unknown) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(result),
      }),
    }),
  };
}

describe("createHqInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLinkedMemberIds).mockResolvedValue(new Set<string>());
  });

  it("throws AllianceServerRequiredError when alliance has no game server", async () => {
    let selectCalls = 0;
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => {
        selectCalls += 1;
        if (selectCalls === 1) {
          return dbSelectChain([{ id: "role-member" }]);
        }
        if (selectCalls === 2) {
          return dbSelectChain([{ permissionId: "members:read" }]);
        }
        if (selectCalls === 3) {
          return dbSelectChain([{ id: "alliance-1" }]);
        }
        throw new Error(`unexpected select call ${selectCalls}`);
      }),
    } as never);

    vi.mocked(resolveAllianceGameServerNumber).mockResolvedValue(null);

    await expect(
      createHqInvite({
        allianceId: "alliance-1",
        kind: "protected_link",
        roleName: "member",
        invitedByHqUserId: "user-1",
        origin: "https://hq.test",
      }),
    ).rejects.toBeInstanceOf(AllianceServerRequiredError);
  });

  it("allows owner invite before alliance server is linked", async () => {
    let selectCalls = 0;
    const insertValues = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => {
              selectCalls += 1;
              if (selectCalls === 1) {
                return Promise.resolve([{ id: "role-owner" }]);
              }
              if (selectCalls === 2) {
                return Promise.resolve([{ id: "alliance-1" }]);
              }
              return Promise.resolve([]);
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    const result = await createHqInvite({
      allianceId: "alliance-1",
      kind: "protected_link",
      roleName: "owner",
      invitedByHqUserId: "user-1",
      origin: "https://hq.test",
    });

    expect(result.roleName).toBe("owner");
    expect(resolveAllianceGameServerNumber).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalled();
  });

  it("rejects claim invites for commanders already linked through any account", async () => {
    let selectCalls = 0;
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => {
        selectCalls += 1;
        if (selectCalls === 1) {
          return dbSelectChain([{ id: "role-member" }]);
        }
        if (selectCalls === 2) {
          return dbSelectChain([{ permissionId: "members:read" }]);
        }
        if (selectCalls === 3) {
          return dbSelectChain([{ id: "alliance-1" }]);
        }
        if (selectCalls === 4) {
          return dbSelectChain([{ currentName: "Alpha", status: "active" }]);
        }
        throw new Error(`unexpected select call ${selectCalls}`);
      }),
    } as never);
    vi.mocked(resolveAllianceGameServerNumber).mockResolvedValue(1203);
    vi.mocked(getLinkedMemberIds).mockResolvedValue(new Set<string>(["m-1"]));

    await expect(
      createHqInvite({
        allianceId: "alliance-1",
        kind: "protected_link",
        roleName: "member",
        invitedByHqUserId: "user-1",
        origin: "https://hq.test",
        targetAshedMemberId: "m-1",
      }),
    ).rejects.toMatchObject({
      code: "commander_already_claimed",
    } satisfies Partial<CommanderClaimInviteError>);
  });

  it("rejects claim invites for former roster commanders", async () => {
    let selectCalls = 0;
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => {
        selectCalls += 1;
        if (selectCalls === 1) {
          return dbSelectChain([{ id: "role-member" }]);
        }
        if (selectCalls === 2) {
          return dbSelectChain([{ permissionId: "members:read" }]);
        }
        if (selectCalls === 3) {
          return dbSelectChain([{ id: "alliance-1" }]);
        }
        if (selectCalls === 4) {
          return dbSelectChain([{ currentName: "Alpha", status: "former" }]);
        }
        throw new Error(`unexpected select call ${selectCalls}`);
      }),
    } as never);
    vi.mocked(resolveAllianceGameServerNumber).mockResolvedValue(1203);

    await expect(
      createHqInvite({
        allianceId: "alliance-1",
        kind: "protected_link",
        roleName: "member",
        invitedByHqUserId: "user-1",
        origin: "https://hq.test",
        targetAshedMemberId: "m-former",
      }),
    ).rejects.toMatchObject({
      code: "commander_not_found",
    } satisfies Partial<CommanderClaimInviteError>);
  });
});

describe("createHqClaimInvitesBulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAllianceGameServerNumber).mockResolvedValue(123);
    vi.mocked(getLinkedMemberIds).mockResolvedValue(new Set<string>());
  });

  // Each createHqInvite(member, claim target) issues 4 limit() selects in order:
  // role, member role-permission, alliance, roster member. Claimability uses
  // getLinkedMemberIds (mocked separately).
  function claimInviteSelects(name: string): unknown[] {
    return [
      [{ id: "role-member" }],
      [{ permissionId: "members:read" }],
      [{ id: "alliance-1" }],
      [{ currentName: name, status: "active" }],
    ];
  }

  function mockDbWithQueue(selectQueue: unknown[]): { insertCalls: () => number } {
    let inserts = 0;
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectQueue.shift() ?? []),
          }),
        }),
      })),
      insert: vi.fn(() => {
        inserts += 1;
        return {
          values: vi.fn().mockResolvedValue(undefined),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        };
      }),
    } as never);
    return { insertCalls: () => inserts };
  }

  it("creates invites, de-duplicates ids, and skips already-linked commanders", async () => {
    const selectQueue = [
      ...claimInviteSelects("Commander One"),
      ...claimInviteSelects("Commander Two"),
      ...claimInviteSelects("Commander Three"),
    ];
    const { insertCalls } = mockDbWithQueue(selectQueue);
    vi.mocked(getLinkedMemberIds)
      .mockResolvedValueOnce(new Set<string>())
      .mockResolvedValueOnce(new Set<string>(["m2"]))
      .mockResolvedValueOnce(new Set<string>());

    const result = await createHqClaimInvitesBulk({
      allianceId: "alliance-1",
      targetAshedMemberIds: ["m1", "m1", "m2", "m3"],
      invitedByHqUserId: "user-1",
      origin: "https://hq.test",
    });

    expect(result.created).toHaveLength(2);
    expect(result.created.map((c) => c.targetAshedMemberId)).toEqual(["m1", "m3"]);
    expect(result.created.map((c) => c.targetCommanderName)).toEqual([
      "Commander One",
      "Commander Three",
    ]);
    expect(result.skipped).toEqual([
      { ashedMemberId: "m2", code: "commander_already_claimed" },
    ]);
    // Inserts only for the two successful invites.
    expect(insertCalls()).toBe(2);
  });

  it("bubbles non-claim errors (e.g. alliance server gate)", async () => {
    vi.mocked(resolveAllianceGameServerNumber).mockResolvedValue(null);
    mockDbWithQueue([
      [{ id: "role-member" }],
      [{ permissionId: "members:read" }],
      [{ id: "alliance-1" }],
    ]);

    await expect(
      createHqClaimInvitesBulk({
        allianceId: "alliance-1",
        targetAshedMemberIds: ["m1"],
        invitedByHqUserId: "user-1",
        origin: "https://hq.test",
      }),
    ).rejects.toBeInstanceOf(AllianceServerRequiredError);
  });
});
