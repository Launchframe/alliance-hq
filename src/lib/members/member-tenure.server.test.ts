import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, syncCommanderFromAllianceMember } = vi.hoisted(() => ({
  syncCommanderFromAllianceMember: vi.fn(),
  mockState: {
    selectResults: [] as unknown[][],
    updates: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/members/commander-identity.server", () => ({
  syncCommanderFromAllianceMember,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mockState.selectResults.shift() ?? [],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mockState.updates.push(values);
        },
      }),
    }),
  }),
  schema: {
    memberAllianceTenure: {
      id: "id",
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      joinedAt: "joinedAt",
      leftAt: "leftAt",
    },
  },
}));

import { closeMemberAllianceTenure } from "@/lib/members/member-tenure.server";

describe("member-tenure.server", () => {
  beforeEach(() => {
    mockState.selectResults = [];
    mockState.updates = [];
    syncCommanderFromAllianceMember.mockReset();
  });

  it("preserves the original joinedAt when closing commander tenure", async () => {
    const joinedAt = new Date("2026-01-05T12:00:00.000Z");
    const leftAt = new Date("2026-06-26T20:15:00.000Z");
    mockState.selectResults.push([{ id: "tenure-1", joinedAt }]);

    await closeMemberAllianceTenure({
      allianceId: "alliance-a",
      ashedMemberId: "member-1",
      leftAt,
    });

    expect(mockState.updates[0]).toMatchObject({ leftAt });
    expect(syncCommanderFromAllianceMember).toHaveBeenCalledWith({
      allianceId: "alliance-a",
      ashedMemberId: "member-1",
      joinedAt,
      leftAt,
    });
  });

  it("does not sync commander when no open tenure row exists (repeated close)", async () => {
    // Simulates a repeated roster sync for an already-departed member.
    // The select returns nothing (no open tenure), so the update is a no-op
    // and the commander sync must NOT fire — otherwise it would re-stamp
    // leftAt=now and corrupt the historical departure date.
    mockState.selectResults.push([]); // no active tenure

    const leftAt = new Date("2026-06-26T20:15:00.000Z");
    await closeMemberAllianceTenure({
      allianceId: "alliance-a",
      ashedMemberId: "member-1",
      leftAt,
    });

    expect(syncCommanderFromAllianceMember).not.toHaveBeenCalled();
  });
});
