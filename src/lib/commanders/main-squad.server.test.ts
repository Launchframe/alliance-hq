import { describe, expect, it, vi } from "vitest";

import { parseMainSquadType } from "@/lib/commanders/main-squad.shared";

vi.mock("@/lib/members/commander-access.server", () => ({
  resolveCommanderSessionContext: vi.fn(),
  assertCommanderReadAccess: vi.fn(),
  loadAllianceCommander: vi.fn(),
}));

vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    hqMemberLinks: { allianceId: "allianceId", hqUserId: "hqUserId", ashedMemberId: "ashedMemberId" },
    hqUserCommanders: { hqUserId: "hqUserId", commanderId: "commanderId" },
    commanderAllianceMemberships: {
      commanderId: "commanderId",
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      leftAt: "leftAt",
      status: "status",
      joinedAt: "joinedAt",
    },
    commanders: { id: "id", mainSquad: "mainSquad", mainSquadSource: "mainSquadSource", mainSquadUpdatedAt: "mainSquadUpdatedAt", updatedAt: "updatedAt", currentAllianceId: "currentAllianceId" },
    allianceMembers: { allianceId: "allianceId", ashedMemberId: "ashedMemberId", mainSquad: "mainSquad", updatedAt: "updatedAt" },
  },
}));

import {
  resolveCommanderSessionContext,
  loadAllianceCommander,
} from "@/lib/members/commander-access.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import {
  MainSquadAccessError,
  setMemberMainSquad,
} from "@/lib/commanders/main-squad.server";
import { getDb } from "@/lib/db";

describe("main-squad.server", () => {
  it("parseMainSquadType rejects invalid values used by setMemberMainSquad", async () => {
    vi.mocked(resolveCommanderSessionContext).mockResolvedValue({
      allianceId: "a1",
      hqUserId: "u1",
    });
    vi.mocked(loadAllianceCommander).mockResolvedValue({
      id: "m1",
    } as never);

    await expect(
      setMemberMainSquad({
        sessionId: "s1",
        ashedMemberId: "member1",
        mainSquad: "cavalry",
      }),
    ).rejects.toBeInstanceOf(MainSquadAccessError);
  });

  it("allows officer override when members:write", async () => {
    vi.mocked(resolveCommanderSessionContext).mockResolvedValue({
      allianceId: "a1",
      hqUserId: "officer",
    });
    vi.mocked(loadAllianceCommander).mockResolvedValue({ id: "row" } as never);
    vi.mocked(sessionHasPermission).mockResolvedValue(true);

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ commanderId: "cmd1" }]),
        }),
      }),
    });
    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    vi.mocked(getDb).mockReturnValue({
      select: selectMock,
      update: updateMock,
    } as never);

    const result = await setMemberMainSquad({
      sessionId: "s1",
      ashedMemberId: "member1",
      mainSquad: "tank",
      asOfficerOverride: true,
    });

    expect(result).toEqual({ mainSquad: "tank", source: "officer_override" });
    expect(parseMainSquadType("tank")).toBe("tank");
  });
});
