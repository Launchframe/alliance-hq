import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSession: vi.fn(),
  sessionHasPermission: vi.fn(),
  lockAllianceAvailability: vi.fn(),
  lockAllianceTrainSettings: vi.fn(),
  loadAllianceTrainLeadTimeDays: vi.fn(),
  resolveTrainSeasonKey: vi.fn(),
  listActiveAllianceMembersForPool: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  getConductorRecord: vi.fn(),
  loadTrainPaintInputs: vi.fn(),
  prepareTrainPaints: vi.fn(),
  commitTrainPaints: vi.fn(),
  ensureWeekScheduleBaseline: vi.fn(),
  loadVsWeekPlan: vi.fn(),
  loadVsWeekPlanForUpdate: vi.fn(),
  saveVsWeekPlanRow: vi.fn(),
  loadVsStrategyPreferences: vi.fn(),
  loadVsMatchup: vi.fn(),
  loadWeeklyPifBoard: vi.fn(),
  writeAuditLog: vi.fn(),
  getServerCalendarDate: vi.fn(),
  transaction: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    getDb: () => ({
      transaction: mocks.transaction,
      select: () => ({
        from: () => ({
          where: () => ({ limit: mocks.selectLimit }),
        }),
      }),
    }),
    schema: actual.schema,
  };
});
vi.mock("@/lib/vs-performance/ashed-opponent-sync.server", () => ({
  loadVsAllianceLink: vi.fn(async () => null),
  resolveVsScoreReadContext: vi.fn(async () => null),
  vsAshedSyncEligibility: vi.fn(async () => false),
}));
vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAlliancePriorDayVsScoresByMember: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/bff/officer-action-audit.server", () => ({
  writeTrainsOfficerAudit: mocks.writeAuditLog,
}));

vi.mock("@/lib/session", () => ({
  loadSession: mocks.loadSession,
}));
vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermission: mocks.sessionHasPermission,
}));
vi.mock("@/lib/time-off/availability.server", () => ({
  lockAllianceAvailability: mocks.lockAllianceAvailability,
}));
vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeDays: mocks.loadAllianceTrainLeadTimeDays,
}));
vi.mock("@/lib/trains/service", () => ({
  resolveTrainSeasonKey: mocks.resolveTrainSeasonKey,
  loadTrainPaintInputs: mocks.loadTrainPaintInputs,
  prepareTrainPaints: mocks.prepareTrainPaints,
  commitTrainPaints: mocks.commitTrainPaints,
  ensureWeekScheduleBaseline: mocks.ensureWeekScheduleBaseline,
  lockAllianceTrainSettings: mocks.lockAllianceTrainSettings,
  LockedDayPaintBlockedError: class LockedDayPaintBlockedError extends Error {},
  TrainPastDateError: class TrainPastDateError extends Error {},
}));
vi.mock("@/lib/members/roster.server", () => ({
  listActiveAllianceMembersForPool: mocks.listActiveAllianceMembersForPool,
}));
vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));
vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: mocks.getConductorRecord,
}));
vi.mock("@/lib/vs-performance/weekly-plan.repository.server", () => ({
  loadVsWeekPlan: mocks.loadVsWeekPlan,
  loadVsWeekPlanForUpdate: mocks.loadVsWeekPlanForUpdate,
  saveVsWeekPlanRow: mocks.saveVsWeekPlanRow,
  loadVsStrategyPreferences: mocks.loadVsStrategyPreferences,
  planDraftFromRow: (row: {
    weekStart: string;
    platform: string;
    days: unknown;
    version: number;
    leadDays: number;
    appliedMeta: unknown;
  }) => ({
    weekStart: row.weekStart,
    platform: row.platform,
    days: row.days,
    version: row.version,
    leadDays: row.leadDays,
    applied: null,
  }),
}));
vi.mock("@/lib/vs-performance/match-results.repository.server", () => ({
  loadVsMatchup: mocks.loadVsMatchup,
}));
vi.mock("@/lib/vs-performance/weekly-pif.server", () => ({
  loadWeeklyPifBoard: mocks.loadWeeklyPifBoard,
}));
vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/trains/game-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/game-time")>();
  return { ...actual, getServerCalendarDate: mocks.getServerCalendarDate };
});

import {
  loadVsPerformanceWeek,
  previewVsWeekPlan,
  saveVsWeekPlan,
  vsScope,
} from "./weekly-plan.server";
import type { VsPlanDay, VsPlanDraft } from "./weekly-plan.shared";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";

const WEEK = "2026-09-21";
const TODAY = "2026-09-23";
const actor = { sessionId: "s1", hqUserId: "u1", allianceId: "a1" };
const PUSH: ConductorRule = { kind: "vs_top_n", topN: 10 };
const R3: ConductorRule = { kind: "rank_pool", pool: "r3", draw: "wheel" };

function day(index: number, partial: Partial<VsPlanDay> = {}): VsPlanDay {
  const dates = [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
  ];
  return {
    scoreDate: dates[index]!,
    strategy: "undecided",
    pushTopN: 10,
    heavyHitterReward: false,
    ...partial,
  };
}

function draft(days: VsPlanDay[], platform = "strategic_victory"): VsPlanDraft {
  return { weekStart: WEEK, platform: platform as VsPlanDraft["platform"], days };
}

const defaultDays = () => [0, 1, 2, 3, 4, 5].map((i) => day(i));

function planRow(days: VsPlanDay[], version = 2, platform = "strategic_victory") {
  return {
    id: "plan1",
    allianceId: "a1",
    weekStart: WEEK,
    platform,
    days,
    version,
    leadDays: 0,
    appliedMeta: null,
  };
}

const trainDates = [
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
];

const dayConfig = new Map<string, ConductorRule | null>();
const records = new Map<
  string,
  {
    conductorMemberId?: string | null;
    conductorMemberName?: string | null;
    lockedAt?: Date | null;
  } | null
>();
const preparedOverrides = new Map<
  string,
  { snapshotMismatch?: boolean; keepAssigned?: boolean }
>();

beforeEach(() => {
  vi.clearAllMocks();
  dayConfig.clear();
  records.clear();
  preparedOverrides.clear();

  mocks.getServerCalendarDate.mockReturnValue(TODAY);
  mocks.loadAllianceTrainLeadTimeDays.mockResolvedValue(0);
  mocks.resolveTrainSeasonKey.mockResolvedValue("seas1");
  mocks.loadVsStrategyPreferences.mockResolvedValue({
    version: 1,
    defaults: { mon: 1, tue: 10, wed: 10, thu: 1, fri: 10, sat: 10 },
  });
  mocks.loadVsMatchup.mockResolvedValue(null);
  mocks.loadWeeklyPifBoard.mockResolvedValue(null);
  mocks.loadSession.mockResolvedValue({
    id: "s1",
    hqUserId: "u1",
    currentAllianceId: "a1",
    allianceId: "a1",
  });
  mocks.sessionHasPermission.mockResolvedValue(true);
  mocks.selectLimit.mockResolvedValue([]);
  mocks.loadVsWeekPlan.mockResolvedValue(null);
  mocks.loadVsWeekPlanForUpdate.mockResolvedValue(null);
  mocks.listActiveAllianceMembersForPool.mockResolvedValue([]);
  mocks.lockAllianceAvailability.mockResolvedValue(undefined);
  mocks.lockAllianceTrainSettings.mockResolvedValue({
    leadDays: 0,
    seasonKey: "seas1",
    trainWeekConfig: {},
  });
  mocks.loadTrainPaintInputs.mockImplementation(
    async (_allianceId: string, patches: { date: string }[]) => ({
      seasonKey: "seas1",
      trainWeekConfig: {},
      weekStarts: [...new Set(patches.map((p) => p.date.slice(0, 10)))],
      activeMemberIds: new Set<string>(),
    }),
  );
  mocks.resolveRollDayConfig.mockImplementation(
    async (_a: string, date: string) => ({
      conductorRule: dayConfig.get(date) ?? null,
      vipRule: null,
    }),
  );
  mocks.getConductorRecord.mockImplementation(
    async (_a: string, date: string) => records.get(date) ?? null,
  );
  mocks.prepareTrainPaints.mockImplementation(
    async (_a: string, patches: { date: string; conductorRule?: ConductorRule | null }[]) =>
      patches.map((patch) => {
        const record = records.get(patch.date) ?? null;
        const overrides = preparedOverrides.get(patch.date) ?? {};
        return {
          date: patch.date,
          scheduleId: "sched",
          paintedConfig: {},
          mergedRules: {
            conductorRule: patch.conductorRule ?? null,
            vipRule: null,
          },
          previousConductorRule: dayConfig.get(patch.date) ?? null,
          previousVipRule: null,
          record,
          conductorChanged: true,
          snapshotMismatch: overrides.snapshotMismatch ?? false,
          keepAssigned: overrides.keepAssigned ?? true,
        };
      }),
  );
  mocks.commitTrainPaints.mockResolvedValue(undefined);
  mocks.ensureWeekScheduleBaseline.mockResolvedValue(undefined);
  mocks.saveVsWeekPlanRow.mockResolvedValue({});
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  );
});

const scope = () => vsScope(actor, WEEK);

describe("previewVsWeekPlan", () => {
  it("rejects edits to protected past days", async () => {
    const saved = planRow(defaultDays());
    mocks.loadVsWeekPlan.mockResolvedValue(saved);
    const bad = draft(defaultDays().map((d, i) => (i === 0 ? { ...d, strategy: "push" as const, pushTopN: 10 as const } : d)));
    await expect(
      previewVsWeekPlan(actor, bad, 2, scope()),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
    expect(mocks.prepareTrainPaints).not.toHaveBeenCalled();
  });

  it("rejects edits to locked days", async () => {
    const saved = planRow(defaultDays());
    mocks.loadVsWeekPlan.mockResolvedValue(saved);
    records.set(trainDates[3]!, { lockedAt: new Date() });
    const bad = draft(
      defaultDays().map((d, i) =>
        i === 3 ? { ...d, strategy: "push" as const, pushTopN: 5 as const } : d,
      ),
    );
    await expect(
      previewVsWeekPlan(actor, bad, 2, scope()),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
  });

  it("preserves a historical Friday heavy-hitter day across a platform switch", async () => {
    const savedDays = defaultDays().map((d, i) =>
      i === 4
        ? { ...d, strategy: "unrestricted" as const, heavyHitterReward: true }
        : d,
    );
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(savedDays));
    records.set(trainDates[4]!, { lockedAt: new Date() });
    const next = draft(
      savedDays.map((d) => ({ ...d })),
      "save_week",
    );
    const preview = await previewVsWeekPlan(actor, next, 2, scope());
    expect(preview.planVersion).toBe(2);
    expect(preview.protectedDates).toContain("2026-09-25");
    const paintedDates = (
      mocks.prepareTrainPaints.mock.calls[0]?.[1] ?? []
    ).map((p: { date: string }) => p.date);
    expect(paintedDates).not.toContain(trainDates[4]);
    await expect(
      previewVsWeekPlan(
        actor,
        draft(
          savedDays.map((d, i) =>
            i === 4
              ? { ...d, strategy: "push" as const, heavyHitterReward: false }
              : d,
          ),
          "save_week",
        ),
        2,
        scope(),
      ),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
  });

  it("leaves manual overrides untouched on an unrelated day edit", async () => {
    const saved = defaultDays().map((d, i) =>
      i === 3 ? { ...d, strategy: "push" as const, pushTopN: 10 as const } : d,
    );
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(saved));
    dayConfig.set(trainDates[3]!, R3);
    const next = draft(
      saved.map((d, i) =>
        i === 4 ? { ...d, strategy: "hard_save" as const } : d,
      ),
    );
    const preview = await previewVsWeekPlan(actor, next, 2, scope());
    expect(preview.changes.map((c) => c.scoreDate)).toEqual(["2026-09-25"]);
  });

  it("reapplies an overridden day only when reapplyDates asks", async () => {
    const saved = defaultDays().map((d, i) =>
      i === 3 ? { ...d, strategy: "push" as const, pushTopN: 10 as const } : d,
    );
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(saved));
    dayConfig.set(trainDates[3]!, R3);
    const next = draft(saved.map((d) => ({ ...d })));
    const preview = await previewVsWeekPlan(actor, next, 2, scope(), [
      "2026-09-24",
    ]);
    expect(preview.changes.map((c) => c.scoreDate)).toEqual(["2026-09-24"]);
  });

  it("rejects reapplyDates outside the week or on protected days", async () => {
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(defaultDays()));
    await expect(
      previewVsWeekPlan(actor, draft(defaultDays()), 2, scope(), [
        "2026-09-21",
      ]),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      previewVsWeekPlan(actor, draft(defaultDays()), 2, scope(), [
        "2026-10-01",
      ]),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("warns about same-rule stale conductor clears in the preview", async () => {
    const saved = defaultDays().map((d, i) =>
      i === 3 ? { ...d, strategy: "push" as const, pushTopN: 10 as const } : d,
    );
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(saved));
    dayConfig.set(trainDates[3]!, PUSH);
    records.set(trainDates[3]!, {
      conductorMemberId: "m9",
      conductorMemberName: "Gone Member",
    });
    preparedOverrides.set(trainDates[3]!, {
      snapshotMismatch: true,
      keepAssigned: false,
    });
    const preview = await previewVsWeekPlan(
      actor,
      draft(saved.map((d) => ({ ...d }))),
      2,
      scope(),
    );
    const change = preview.changes.find((c) => c.scoreDate === "2026-09-24");
    expect(change?.clearConductorName).toBe("Gone Member");
  });

  it("writes nothing during preview", async () => {
    const next = draft(
      defaultDays().map((d, i) =>
        i === 4 ? { ...d, strategy: "hard_save" as const } : d,
      ),
    );
    await previewVsWeekPlan(actor, next, 0, scope());
    expect(mocks.ensureWeekScheduleBaseline).not.toHaveBeenCalled();
    expect(mocks.commitTrainPaints).not.toHaveBeenCalled();
    expect(mocks.saveVsWeekPlanRow).not.toHaveBeenCalled();
    const opts = mocks.prepareTrainPaints.mock.calls[0]![3];
    expect(opts.readOnly).toBe(true);
    expect(opts.updateSeason).toBe(false);
  });
});

describe("saveVsWeekPlan", () => {
  it("rejects a stale expectedVersion inside the locked transaction", async () => {
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(defaultDays(), 3));
    mocks.loadVsWeekPlanForUpdate.mockResolvedValue(planRow(defaultDays(), 3));
    await expect(
      saveVsWeekPlan(actor, {
        draft: draft(
          defaultDays().map((d, i) =>
            i === 4 ? { ...d, strategy: "hard_save" as const } : d,
          ),
        ),
        expectedVersion: 2,
        fingerprint: "x",
        scope: scope(),
      }),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
    expect(mocks.saveVsWeekPlanRow).not.toHaveBeenCalled();
    expect(mocks.commitTrainPaints).not.toHaveBeenCalled();
  });

  it("rejects when alliance lead time changed since preview", async () => {
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(defaultDays()));
    mocks.loadVsWeekPlanForUpdate.mockResolvedValue(planRow(defaultDays()));
    mocks.lockAllianceTrainSettings.mockResolvedValue({
      leadDays: 2,
      seasonKey: "seas1",
      trainWeekConfig: {},
    });
    await expect(
      saveVsWeekPlan(actor, {
        draft: draft(defaultDays()),
        expectedVersion: 2,
        fingerprint: "x",
        scope: scope(),
      }),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
    expect(mocks.saveVsWeekPlanRow).not.toHaveBeenCalled();
  });

  it("rejects when the recomputed fingerprint no longer matches", async () => {
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(defaultDays()));
    mocks.loadVsWeekPlanForUpdate.mockResolvedValue(planRow(defaultDays()));
    await expect(
      saveVsWeekPlan(actor, {
        draft: draft(
          defaultDays().map((d, i) =>
            i === 4 ? { ...d, strategy: "hard_save" as const } : d,
          ),
        ),
        expectedVersion: 2,
        fingerprint: "not-the-preview-fingerprint",
        scope: scope(),
      }),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
    expect(mocks.ensureWeekScheduleBaseline).not.toHaveBeenCalled();
    expect(mocks.commitTrainPaints).not.toHaveBeenCalled();
  });
});

describe("loadVsPerformanceWeek", () => {
  it("performs no writes", async () => {
    mocks.loadVsWeekPlan.mockResolvedValue(planRow(defaultDays()));
    const payload = await loadVsPerformanceWeek("s1", WEEK);
    expect(payload.weekStart).toBe(WEEK);
    expect(payload.scope).toBe(scope());
    expect(mocks.saveVsWeekPlanRow).not.toHaveBeenCalled();
    expect(mocks.commitTrainPaints).not.toHaveBeenCalled();
    expect(mocks.ensureWeekScheduleBaseline).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a non-Monday weekStart", async () => {
    await expect(
      loadVsPerformanceWeek("s1", "2026-09-22"),
    ).rejects.toThrow();
  });
});
