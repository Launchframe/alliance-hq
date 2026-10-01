import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureRows: [] as Record<string, unknown>[],
  order: [] as string[],
  lockAllianceAvailability: vi.fn(async () => {}),
  assertVsActorContextTx: vi.fn(async () => {}),
  assertVsActorCurrent: vi.fn(async () => {}),
  assertVsScope: vi.fn(),
  loadVsMatchupRowForUpdate: vi.fn(),
  loadVsMatchDayResultForUpdate: vi.fn(),
  upsertVsMatchup: vi.fn(),
  markVsOpponentFieldsDirty: vi.fn(),
  saveVsMatchDayResultTx: vi.fn(),
  writeTrainsOfficerAudit: vi.fn(async () => {}),
  loadVsPerformanceWeek: vi.fn(async () => ({ week: true })),
  attemptVsOpponentSync: vi.fn(async () => null),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === actual.schema.vsCaptureReviews) {
              mocks.order.push("select:capture");
              return mocks.captureRows.slice(0, 1);
            }
            if (table === actual.schema.alliances) {
              return [{ tag: "LFgo", gameServerNumber: 1203 }];
            }
            return [];
          },
          for: () => ({
            limit: async () => {
              if (table === actual.schema.vsCaptureReviews) {
                mocks.order.push("select:capture");
                return mocks.captureRows.slice(0, 1);
              }
              return [];
            },
          }),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => Promise.resolve() }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeDb),
  };
  return { schema: actual.schema, getDb: () => fakeDb };
});

vi.mock("@/lib/time-off/availability.server", () => ({
  lockAllianceAvailability: (...args: unknown[]) => {
    mocks.order.push("lock");
    return (mocks.lockAllianceAvailability as (...a: unknown[]) => unknown)(...args);
  },
}));
vi.mock("@/lib/vs-performance/vs-scope.server", () => ({
  assertVsActorCurrent: (...args: unknown[]) =>
    (mocks.assertVsActorCurrent as (...a: unknown[]) => unknown)(...args),
  assertVsActorContextTx: (...args: unknown[]) => {
    mocks.order.push("ctx");
    return (mocks.assertVsActorContextTx as (...a: unknown[]) => unknown)(...args);
  },
  assertVsScope: (...args: unknown[]) => (mocks.assertVsScope as (...a: unknown[]) => unknown)(...args),
  vsContextScope: () => "scope",
}));
vi.mock("@/lib/vs-performance/match-results.repository.server", () => ({
  loadVsMatchupRowForUpdate: (...args: unknown[]) =>
    (mocks.loadVsMatchupRowForUpdate as (...a: unknown[]) => unknown)(...args),
  loadVsMatchDayResultForUpdate: (...args: unknown[]) =>
    (mocks.loadVsMatchDayResultForUpdate as (...a: unknown[]) => unknown)(...args),
  upsertVsMatchup: (...args: unknown[]) => (mocks.upsertVsMatchup as (...a: unknown[]) => unknown)(...args),
  markVsOpponentFieldsDirty: (...args: unknown[]) =>
    (mocks.markVsOpponentFieldsDirty as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/vs-performance/match-results.server", () => ({
  saveVsMatchDayResultTx: (...args: unknown[]) =>
    (mocks.saveVsMatchDayResultTx as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/bff/officer-action-audit.server", () => ({
  writeTrainsOfficerAudit: (...args: unknown[]) =>
    (mocks.writeTrainsOfficerAudit as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/vs-performance/weekly-plan.server", () => ({
  loadVsPerformanceWeek: (...args: unknown[]) =>
    (mocks.loadVsPerformanceWeek as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/vs-performance/matchup-sync.server", () => ({
  attemptVsOpponentSync: (...args: unknown[]) =>
    (mocks.attemptVsOpponentSync as (...a: unknown[]) => unknown)(...args),
}));

import { commitVsCaptureReview } from "./vs-capture.server";
import { vsCaptureReviewSchema } from "./vs-capture.shared";
import type { VsActor } from "./weekly-view.shared";

const actor: VsActor = {
  sessionId: "sess-1",
  hqUserId: "u1",
  allianceId: "a1",
};

const weekStart = "2026-08-31";

const review = {
  kind: "daily_totals" as const,
  weekStart,
  ourSide: "left" as const,
  confirmSides: true as const,
  left: { server: 1203, tag: "LFgo", name: null },
  right: { server: 1236, tag: "TriV", name: null },
  day: 1,
  leftScore: "2241713380",
  rightScore: "2222858900",
  finalDay: true,
};

const body = {
  review,
  expectedReviewVersion: 1,
  expectedMatchupVersion: 0,
  expectedDayVersions: { "2026-08-31": 0 },
  requestId: "req-standalone",
  scope: "scope:week",
};

function bodyHash() {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "review-1",
        vsCaptureReviewSchema.parse(review),
        body.expectedReviewVersion,
        body.expectedMatchupVersion,
        Object.entries(body.expectedDayVersions).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        body.requestId,
        body.scope,
      ]),
    )
    .digest("hex");
}

const pendingRow = {
  id: "review-1",
  allianceId: "a1",
  createdByHqUserId: "u1",
  status: "pending",
  version: 1,
  expiresAt: new Date(Date.now() + 60_000),
  kind: "daily_totals",
};

describe("commitVsCaptureReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureRows.length = 0;
    mocks.order.length = 0;
    mocks.captureRows.push({ ...pendingRow });
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(null);
    mocks.upsertVsMatchup.mockResolvedValue({ id: "matchup-1" });
    mocks.saveVsMatchDayResultTx.mockResolvedValue({ replayed: false });
    mocks.loadVsPerformanceWeek.mockResolvedValue({ week: true });
  });

  it("checks alliance context before locking the capture row, even on replay", async () => {
    mocks.assertVsActorContextTx.mockRejectedValueOnce(
      new Error("stale_context"),
    );
    mocks.captureRows[0] = {
      ...pendingRow,
      status: "complete",
      completedRequestId: body.requestId,
      completedBodyHash: bodyHash(),
      completedResult: { weekStart, savedDays: ["2026-08-31"] },
    };
    await expect(
      commitVsCaptureReview(actor, "review-1", body),
    ).rejects.toThrow("stale_context");
    expect(mocks.order).toEqual(["lock", "ctx"]);
    expect(mocks.saveVsMatchDayResultTx).not.toHaveBeenCalled();
  });

  it("replays a completed capture row without reapplying day results", async () => {
    mocks.captureRows[0] = {
      ...pendingRow,
      status: "complete",
      completedRequestId: body.requestId,
      completedBodyHash: bodyHash(),
      completedResult: { weekStart, savedDays: ["2026-08-31"] },
    };
    await commitVsCaptureReview(actor, "review-1", body);
    expect(mocks.order.slice(0, 3)).toEqual(["lock", "ctx", "select:capture"]);
    expect(mocks.saveVsMatchDayResultTx).not.toHaveBeenCalled();
    expect(mocks.writeTrainsOfficerAudit).not.toHaveBeenCalled();
    expect(mocks.attemptVsOpponentSync).not.toHaveBeenCalled();
  });

  it("keeps the capture: provenance prefix on saved day results", async () => {
    await commitVsCaptureReview(actor, "review-1", body);
    expect(mocks.saveVsMatchDayResultTx).toHaveBeenCalledTimes(1);
    const call = mocks.saveVsMatchDayResultTx.mock.calls[0]![1] as {
      requestId: string;
      scope: string;
    };
    expect(call.requestId).toBe("capture:review-1:req-standalone:1");
    expect(call.scope).toBe("scope:week");
  });
});
