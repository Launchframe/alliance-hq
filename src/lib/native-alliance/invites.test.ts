import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import { getLinkedMemberIds } from "@/lib/vr/repository";

import { AllianceServerRequiredError } from "./alliance-server-gate.server";
import { createHqInvite, type CommanderClaimInviteError } from "./invites";

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
          return dbSelectChain([{ currentName: "Alpha" }]);
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
});
