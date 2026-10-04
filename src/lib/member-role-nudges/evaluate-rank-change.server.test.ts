import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  setCalls: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  satisfy: vi.fn(),
  materialize: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/member-role-nudges/inbox.server", () => ({
  satisfyMemberRoleNudgeInboxItem: state.satisfy,
  materializeMemberRoleNudgeInboxItem: state.materialize,
}));
vi.mock("@/lib/db", async (original) => {
  const mod = await original<typeof import("@/lib/db")>();
  const nextResult = async () => state.selectResults.shift() ?? [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: nextResult,
          orderBy: nextResult,
          then: (resolve: (rows: unknown[]) => unknown) =>
            nextResult().then(resolve),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.setCalls.push(values);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        state.inserted.push(values);
      },
    }),
  };
  return { ...mod, getDb: () => db };
});

import { ROLE_IDS } from "@/lib/rbac/constants";
import { evaluateMemberRoleNudgesOnRankChange } from "./evaluate-rank-change.server";

const base = { allianceId: "alliance", ashedMemberId: "member-1" };

beforeEach(() => {
  vi.clearAllMocks();
  state.selectResults = [];
  state.setCalls = [];
  state.inserted = [];
});

it("supersedes open deescalate on an into-R4 crossing even when the decision skips", async () => {
  state.selectResults = [
    [{ id: "open-deescalate" }],
    [{ hqUserId: "hq-1" }],
    [{ roleId: ROLE_IDS.officer }],
    [],
  ];
  const result = await evaluateMemberRoleNudgesOnRankChange({
    ...base,
    previousRank: 3,
    nextRank: 4,
    rankEventId: "event-1",
  });
  expect(result.nudgeId).toBeNull();
  expect(state.setCalls).toEqual([
    expect.objectContaining({ status: "superseded" }),
  ]);
  expect(state.satisfy).toHaveBeenCalledWith("open-deescalate");
  expect(state.inserted).toEqual([]);
});

it("supersedes open escalates on an out-of-R4 crossing even when the decision skips", async () => {
  state.selectResults = [
    [{ id: "open-escalate" }],
    [{ hqUserId: "hq-1" }],
    [{ roleId: ROLE_IDS.member }],
    [],
  ];
  const result = await evaluateMemberRoleNudgesOnRankChange({
    ...base,
    previousRank: 4,
    nextRank: 2,
    rankEventId: "event-2",
  });
  expect(result.nudgeId).toBeNull();
  expect(state.setCalls).toEqual([
    expect.objectContaining({ status: "superseded" }),
  ]);
  expect(state.satisfy).toHaveBeenCalledWith("open-escalate");
  expect(state.inserted).toEqual([]);
});

it("reopens an escalate after rejection once a new rank event crosses again", async () => {
  state.selectResults = [
    [],
    [],
    [
      {
        kind: "escalate_invite",
        status: "rejected",
        toRank: 4,
        fromRank: 3,
        rankEventId: "earlier-event",
        createdAt: new Date(),
      },
    ],
    [],
    [{ currentName: "R4 Member" }],
  ];
  const result = await evaluateMemberRoleNudgesOnRankChange({
    ...base,
    previousRank: 3,
    nextRank: 4,
    rankEventId: "reentry-event",
  });
  expect(result.kind).toBe("escalate_invite");
  expect(state.inserted).toEqual([
    expect.objectContaining({
      kind: "escalate_invite",
      rankEventId: "reentry-event",
      status: "open",
    }),
  ]);
});

it("does not reopen an escalate rejected on the same rank event", async () => {
  state.selectResults = [
    [],
    [],
    [
      {
        kind: "escalate_invite",
        status: "rejected",
        toRank: 4,
        fromRank: 3,
        rankEventId: "same-event",
        createdAt: new Date(),
      },
    ],
  ];
  const result = await evaluateMemberRoleNudgesOnRankChange({
    ...base,
    previousRank: 3,
    nextRank: 4,
    rankEventId: "same-event",
  });
  expect(result.nudgeId).toBeNull();
  expect(state.inserted).toEqual([]);
});

it("treats a rejected nudge without a rank event as no voucher for later crossings", async () => {
  state.selectResults = [
    [],
    [],
    [
      {
        kind: "escalate_invite",
        status: "rejected",
        toRank: 4,
        fromRank: 3,
        rankEventId: null,
        createdAt: new Date(),
      },
    ],
    [],
    [{ currentName: "R4 Member" }],
  ];
  const result = await evaluateMemberRoleNudgesOnRankChange({
    ...base,
    previousRank: 3,
    nextRank: 4,
    rankEventId: null,
  });
  expect(result.kind).toBe("escalate_invite");
});
