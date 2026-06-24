import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";

import { AllianceServerRequiredError } from "./alliance-server-gate.server";
import { createHqInvite } from "./invites";

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber: vi.fn(),
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
});
