import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  updateReturningCount: 1,
  loadAllianceRow: vi.fn(),
  fetchVsTop: vi.fn(),
  fetchVrTop: vi.fn(),
  previewEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => mocks.selectRows,
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            mocks.updateCalls.push(values);
            return mocks.updateReturningCount > 0 ? [{ id: "rec-1" }] : [];
          },
        }),
      }),
    }),
  }),
  schema: {
    trainConductorRecords: {
      id: "id",
      allianceId: "alliance_id",
      conductorMemberId: "conductor_member_id",
      conductorNumberedRank: "conductor_numbered_rank",
      vipMemberId: "vip_member_id",
      vipNumberedRank: "vip_numbered_rank",
      noVip: "no_vip",
    },
  },
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadAllianceRow: mocks.loadAllianceRow,
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsTopScorersForTrainDate: mocks.fetchVsTop,
}));

vi.mock("@/lib/trains/native-scores.server", () => ({
  fetchNativeVrTopScorers: mocks.fetchVrTop,
}));

vi.mock("@/lib/trains/event-eligibility.server", () => ({
  previewEventEligibility: mocks.previewEvent,
}));

import { backfillNumberedSpinsForScoreSource } from "@/lib/trains/numbered-spin-backfill.server";

describe("backfillNumberedSpinsForScoreSource", () => {
  beforeEach(() => {
    mocks.selectRows = [];
    mocks.updateCalls = [];
    mocks.updateReturningCount = 1;
    mocks.loadAllianceRow.mockReset();
    mocks.fetchVsTop.mockReset();
    mocks.fetchVrTop.mockReset();
    mocks.previewEvent.mockReset();
  });

  it("backfills VS conductor and VIP (excluding conductor) when VS scores arrive", async () => {
    mocks.loadAllianceRow.mockResolvedValue({ trainConductorLeadTimeDays: 0 });
    mocks.selectRows = [
      {
        id: "rec-1",
        allianceId: "a1",
        date: "2026-11-24",
        conductorMemberId: null,
        conductorNumberedRank: 1,
        conductorNumberedPoolSize: 3,
        conductorRule: { kind: "vs_top_n", topN: 3 },
        vipMemberId: null,
        vipNumberedRank: 1,
        vipNumberedPoolSize: 3,
        vipRule: { kind: "vs_top_n", topN: 3 },
        noVip: 0,
      },
    ];
    mocks.fetchVsTop.mockResolvedValue([
      { memberId: "m1", memberName: "Alice" },
      { memberId: "m2", memberName: "Bob" },
      { memberId: "m3", memberName: "Cara" },
      { memberId: "m4", memberName: "Dan" },
    ]);

    const res = await backfillNumberedSpinsForScoreSource({
      allianceId: "a1",
      source: "vs",
      vsRecordedDate: "2026-11-23",
    });

    expect(res).toEqual({ conductorBackfilled: 1, vipBackfilled: 1 });
    expect(mocks.updateCalls[0]).toMatchObject({
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
    });
    // VIP rank #1 excludes newly-backfilled conductor m1, so Bob wins
    expect(mocks.updateCalls[1]).toMatchObject({
      vipMemberId: "m2",
      vipMemberName: "Bob",
    });
  });

  it("backfills VR conductor when VR scores arrive", async () => {
    mocks.selectRows = [
      {
        id: "rec-2",
        allianceId: "a1",
        date: "2026-11-24",
        conductorMemberId: null,
        conductorNumberedRank: 2,
        conductorNumberedPoolSize: 3,
        conductorRule: { kind: "vr_top_n", topN: 3 },
        vipMemberId: null,
        vipNumberedRank: null,
        vipNumberedPoolSize: null,
        vipRule: null,
        noVip: 0,
      },
    ];
    mocks.fetchVrTop.mockResolvedValue([
      { memberId: "m1", memberName: "Alice" },
      { memberId: "m2", memberName: "Bob" },
      { memberId: "m3", memberName: "Cara" },
    ]);

    const res = await backfillNumberedSpinsForScoreSource({
      allianceId: "a1",
      source: "vr",
    });

    expect(res).toEqual({ conductorBackfilled: 1, vipBackfilled: 0 });
    expect(mocks.updateCalls[0]).toMatchObject({
      conductorMemberId: "m2",
      conductorMemberName: "Bob",
    });
  });

  it("backfills event_scores conductor when event evidence is ready", async () => {
    mocks.selectRows = [
      {
        id: "rec-3",
        allianceId: "a1",
        date: "2026-11-24",
        conductorMemberId: null,
        conductorNumberedRank: 1,
        conductorNumberedPoolSize: 5,
        conductorRule: {
          kind: "event_scores",
          source: {
            target: "warzone-duel",
            seriesId: "s1",
            occurrenceId: "occ-1",
            boardKey: null,
            teamScope: null,
          },
          eligibility: "scored",
          topN: 5,
          fallback: "none",
        },
        vipMemberId: null,
        vipNumberedRank: null,
        vipNumberedPoolSize: null,
        vipRule: null,
        noVip: 0,
      },
    ];
    mocks.previewEvent.mockResolvedValue({
      eligibility: {
        ok: true,
        candidates: [{ memberId: "m9", memberName: "Zed" }],
      },
    });

    const res = await backfillNumberedSpinsForScoreSource({
      allianceId: "a1",
      source: "event",
      occurrenceId: "occ-1",
    });

    expect(res).toEqual({ conductorBackfilled: 1, vipBackfilled: 0 });
    expect(mocks.updateCalls[0]).toMatchObject({
      conductorMemberId: "m9",
      conductorMemberName: "Zed",
    });
  });

  it("is idempotent when CAS update returns 0 rows (already assigned)", async () => {
    mocks.updateReturningCount = 0;
    mocks.selectRows = [
      {
        id: "rec-4",
        allianceId: "a1",
        date: "2026-11-24",
        conductorMemberId: null,
        conductorNumberedRank: 1,
        conductorNumberedPoolSize: 3,
        conductorRule: { kind: "vr_top_n", topN: 3 },
        vipMemberId: null,
        vipNumberedRank: null,
        vipNumberedPoolSize: null,
        vipRule: null,
        noVip: 0,
      },
    ];
    mocks.fetchVrTop.mockResolvedValue([{ memberId: "m1", memberName: "Alice" }]);

    const res = await backfillNumberedSpinsForScoreSource({
      allianceId: "a1",
      source: "vr",
    });

    expect(res).toEqual({ conductorBackfilled: 0, vipBackfilled: 0 });
  });
});
