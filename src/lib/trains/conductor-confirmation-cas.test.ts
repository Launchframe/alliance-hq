import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  lockedRead: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  writeAuditLog: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
  getPoolSummary: vi.fn(),
  getEffectiveSeasonForAlliance: vi.fn(),
  resolveTrainDayContext: vi.fn(),
  rollForConductor: vi.fn(),
  fetchAllianceVsTopScorersForTrainDate: vi.fn(),
  listActiveAllianceMembersForPool: vi.fn(),
  lockConductorRecord: vi.fn(),
}));

vi.mock("@/lib/time-off/availability.server", () => ({
  loadTimeOffAvailability: vi.fn(async () => ({ awayMemberIds: new Set() })),
  lockAllianceAvailability: vi.fn(),
}));

vi.mock("@/lib/time-off/coverage.server", () => ({
  findCoverageConflicts: vi.fn(async () => []),
  trainCoverageDuties: vi.fn(() => []),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction: async (work: (tx: unknown) => unknown) => work({ select: () => ({ from: () => ({ where: () => ({ for: mocks.lockedRead }) }) }), update: mocks.update, insert: mocks.insert }),
    select: mocks.select,
    update: mocks.update,
    insert: mocks.insert,
  }),
  schema: {
    alliances: {
      id: "id",
      trainWeekStartDow: "trainWeekStartDow",
      trainConductorLeadTimeDays: "trainConductorLeadTimeDays",
      trainConductorConfirmationEnabled: "trainConductorConfirmationEnabled",
    },
    trainConductorRecords: {
      id: "id",
      allianceId: "allianceId",
      date: "date",
      lockedAt: "lockedAt",
      conductorNominationStatus: "conductorNominationStatus",
      confirmationDeadlineAt: "confirmationDeadlineAt",
      successorAttempt: "successorAttempt",
      nominatedAt: "nominatedAt",
    },
    conductorPoolEntries: {
      allianceId: "allianceId",
      poolType: "poolType",
      selectedAt: "selectedAt",
      memberId: "memberId",
      memberName: "memberName",
      allianceRank: "allianceRank",
      sequencePosition: "sequencePosition",
    },
  },
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("@/lib/trains/pool", () => ({
  releasePoolSelectionForDate: mocks.releasePoolSelectionForDate,
  getPoolSummary: mocks.getPoolSummary,
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/train-day-context.server", () => ({
  resolveTrainDayContext: mocks.resolveTrainDayContext,
  resolveMergedDayConfigsForDateRange: vi.fn(),
}));

vi.mock("@/lib/trains/service", () => ({
  rollForConductor: mocks.rollForConductor,
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsTopScorersForTrainDate:
    mocks.fetchAllianceVsTopScorersForTrainDate,
}));

vi.mock("@/lib/members/roster.server", () => ({
  listActiveAllianceMembersForPool: mocks.listActiveAllianceMembersForPool,
}));

vi.mock("@/lib/trains/repository", () => ({
  lockConductorRecord: mocks.lockConductorRecord,
  upsertConductorDraft: vi.fn(),
}));

vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeSettings: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: () => "new-rec-id" }));

import {
  confirmConductorPlacement,
  nominateConductorForDate,
  processConductorConfirmationTick,
} from "@/lib/trains/conductor-confirmation.server";

function chainSelect(rows: unknown[]) {
  mocks.limit.mockResolvedValueOnce(rows);
}

describe("conductor confirmation CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({
      limit: mocks.limit,
      orderBy: vi.fn().mockReturnValue({ limit: mocks.limit }),
    });
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.releasePoolSelectionForDate.mockResolvedValue(undefined);
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.resolveTrainDayContext.mockResolvedValue({
      dayConfig: {
        conductorMechanism: "r3_lottery",
        conductorConfig: null,
        paintTemplate: "economy_week",
      },
      leadDays: 0,
      scoreDateDay: null,
    });
    mocks.fetchAllianceVsTopScorersForTrainDate.mockResolvedValue([]);
  });

  it("confirmConductorPlacement no-ops when tick already promoted (empty RETURNING)", async () => {
    chainSelect([
      {
        id: "rec-1",
        allianceId: "ally-1",
        date: "2026-06-11",
        lockedAt: null,
        conductorNominationStatus: "pending_confirmation",
        conductorMemberId: "m1",
      },
    ]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    const result = await confirmConductorPlacement({
      allianceId: "ally-1",
      recordId: "rec-1",
      officerHqUserId: "hq-1",
      sessionId: "sess-1",
    });

    expect(result).toEqual({ ok: false, reason: "not_pending" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("confirmConductorPlacement audits when CAS wins", async () => {
    chainSelect([
      {
        id: "rec-1",
        allianceId: "ally-1",
        date: "2026-06-11",
        lockedAt: null,
        conductorNominationStatus: "pending_confirmation",
        conductorMemberId: "m1",
      },
    ]);
    mocks.updateReturning.mockResolvedValueOnce([{ id: "rec-1" }]);

    const result = await confirmConductorPlacement({
      allianceId: "ally-1",
      recordId: "rec-1",
      officerHqUserId: "hq-1",
      sessionId: "sess-1",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.writeAuditLog).toHaveBeenCalledOnce();
  });

  it("nominateConductorForDate releases rolled pool seat when CAS loses", async () => {
    chainSelect([
      {
        id: "ally-1",
        trainWeekStartDow: 1,
        trainConductorLeadTimeDays: 0,
        trainConductorConfirmationEnabled: 1,
      },
    ]);
    chainSelect([
      {
        id: "rec-1",
        allianceId: "ally-1",
        date: "2026-06-12",
        lockedAt: null,
        conductorNominationStatus: null,
        conductorMemberId: null,
        conductorMemberName: null,
        updatedAt: new Date(0),
      },
    ]);
    mocks.rollForConductor.mockResolvedValueOnce({
      memberId: "m-bob",
      memberName: "Bob",
      mechanism: "r3_lottery",
    });
    mocks.lockedRead.mockResolvedValueOnce([{ id: "rec-1", updatedAt: new Date(0), lockedAt: null }]);
    // buildSuccessionSnapshot pool rows
    chainSelect([]);
    mocks.updateReturning.mockResolvedValueOnce([]);

    const result = await nominateConductorForDate({
      allianceId: "ally-1",
      trainDate: "2026-06-12",
      trigger: { mode: "scheduled_reset", anchor: "day_before_train" },
    });

    expect(result).toEqual({
      ok: true,
      recordId: "rec-1",
      reason: "already_nominated",
    });
    expect(mocks.releasePoolSelectionForDate).toHaveBeenCalledWith(
      "ally-1",
      "2026-06-12",
      "m-bob",
    );
  });

  it("processConductorConfirmationTick skips pool release when promote CAS loses", async () => {
    const now = Date.now();
    const pending = {
      id: "rec-1",
      allianceId: "ally-1",
      date: "2026-06-11",
      lockedAt: null,
      conductorNominationStatus: "pending_confirmation",
      confirmationDeadlineAt: new Date(now - 1000),
      nominatedAt: new Date(now - 10 * 60 * 1000),
      updatedAt: new Date(now - 10 * 60 * 1000),
      successorAttempt: 0,
      conductorMemberId: "m-alice",
      conductorMemberName: "Alice",
      successionSnapshot: [
        { memberId: "m-alice", memberName: "Alice" },
        { memberId: "m-bob", memberName: "Bob" },
      ],
    };

    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        // expired pending nominations
        return {
          from: () => ({
            where: () => Promise.resolve([pending]),
          }),
        };
      }
      // lockable confirmed/fallback — none
      return {
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      };
    });

    mocks.lockedRead.mockResolvedValueOnce([pending]);
    // promoteSuccessor CAS loses to concurrent confirm
    mocks.updateReturning.mockResolvedValueOnce([]);

    const result = await processConductorConfirmationTick();

    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalled();
    expect(mocks.getPoolSummary).not.toHaveBeenCalled();
    expect(result.forfeits).toBe(0);
    expect(result.fallbacks).toBe(0);
  });
});
