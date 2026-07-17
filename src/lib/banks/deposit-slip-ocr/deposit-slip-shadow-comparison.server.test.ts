import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const mockState = {
  /** Consumed in call order by the module's sequential `db.select(...)` calls. */
  selectQueue: [] as Row[][],
  updateSets: [] as Row[],
  persistCalls: [] as Row[],
  /**
   * Rows returned by the atomic comparisonJson claim (`UPDATE … RETURNING`).
   * Empty array = lost the race (no-op after compute).
   */
  claimReturns: [] as Row[][],
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          // Real Drizzle query builders are awaitable directly (no `.limit()`
          // required) *and* expose `.limit(n)` for callers that chain it —
          // this module does both. Attaching `.limit` to a resolved promise
          // supports either usage against the same queue.
          const rows = mockState.selectQueue.shift() ?? [];
          const promise = Promise.resolve(rows) as Promise<Row[]> & {
            limit: (n: number) => Promise<Row[]>;
          };
          promise.limit = async () => rows;
          return promise;
        },
      }),
    }),
    update: () => ({
      set: (values: Row) => {
        mockState.updateSets.push(values);
        return {
          where: () => ({
            returning: async () =>
              mockState.claimReturns.shift() ?? [{ id: GROUP_ID }],
          }),
        };
      },
    }),
  }),
  schema: {
    videoUploadGroups: {
      id: "videoUploadGroups.id",
      primaryJobId: "videoUploadGroups.primaryJobId",
      boardKey: "videoUploadGroups.boardKey",
      hqEventId: "videoUploadGroups.hqEventId",
      comparisonJson: "videoUploadGroups.comparisonJson",
    },
    videoJobs: {
      id: "videoJobs.id",
      groupId: "videoJobs.groupId",
      passRole: "videoJobs.passRole",
      status: "videoJobs.status",
      parseSessionId: "videoJobs.parseSessionId",
      timingsJson: "videoJobs.timingsJson",
    },
    parseSessions: {
      id: "parseSessions.id",
      status: "parseSessions.status",
      dedupeReportJson: "parseSessions.dedupeReportJson",
    },
    parsedRows: {
      parseSessionId: "parsedRows.parseSessionId",
      ocrName: "parsedRows.ocrName",
      score: "parsedRows.score",
      powerLevel: "parsedRows.powerLevel",
      memberLevel: "parsedRows.memberLevel",
      profession: "parsedRows.profession",
      deleted: "parsedRows.deleted",
    },
  },
}));

vi.mock("@/lib/banks/deposit-slip-ocr/deposit-slip-ocr-eval-snapshots.server", () => ({
  persistDepositSlipOcrEvalSnapshot: vi.fn(async (input: Row) => {
    mockState.persistCalls.push(input);
    return "snapshot-id";
  }),
}));

import { persistDepositSlipOcrEvalSnapshot } from "@/lib/banks/deposit-slip-ocr/deposit-slip-ocr-eval-snapshots.server";
import { maybeCompareDepositSlipFingerprintShadow } from "@/lib/banks/deposit-slip-ocr/deposit-slip-shadow-comparison.server";

const GROUP_ID = "group-1";

function queueHappyPath(overrides?: {
  primaryRows?: Row[];
  shadowRows?: Row[];
}) {
  mockState.selectQueue = [
    // group
    [
      {
        primaryJobId: "primary-job",
        boardKey: "board-1",
        hqEventId: "event-1",
        comparisonJson: null,
      },
    ],
    // primary job
    [{ parseSessionId: "primary-session" }],
    // primary parse session
    [{ status: "submitted" }],
    // shadow job
    [
      {
        id: "shadow-job",
        status: "complete",
        parseSessionId: "shadow-session",
        timingsJson: { totalMs: 4200 },
      },
    ],
    // shadow parse session (dedupe report)
    [{ dedupeReportJson: { rawLineCount: 100, uniqueLineCount: 61 } }],
  ];
  return {
    primaryRows:
      overrides?.primaryRows ??
      [
        {
          ocrName: "Bat Pig",
          score: "5000",
          powerLevel: "2026-07-14T13:18:00.000Z",
          memberLevel: 3,
          profession: "locked",
          deleted: 0,
        },
      ],
    shadowRows:
      overrides?.shadowRows ??
      [
        {
          ocrName: "Bat Pig",
          score: "5000",
          powerLevel: "2026-07-14T13:18:00.000Z",
          memberLevel: 3,
          profession: "locked",
          deleted: 0,
        },
      ],
  };
}

describe("maybeCompareDepositSlipFingerprintShadow", () => {
  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.updateSets = [];
    mockState.persistCalls = [];
    mockState.claimReturns = [];
    vi.clearAllMocks();
  });

  it("claims comparison_json then persists a snapshot when both sides are ready", async () => {
    const { primaryRows, shadowRows } = queueHappyPath();
    // Two parallel Promise.all selects (primary rows, shadow rows) resolve in
    // call order against the shared queue.
    mockState.selectQueue.push(primaryRows, shadowRows);

    await maybeCompareDepositSlipFingerprintShadow({ groupId: GROUP_ID });

    expect(mockState.updateSets).toHaveLength(1);
    const comparisonJson = mockState.updateSets[0]?.comparisonJson as Row;
    expect(comparisonJson.deposit_slip_fingerprint_shadow).toMatchObject({
      kind: "deposit_slip_fingerprint_shadow",
      primaryJobId: "primary-job",
      shadowJobId: "shadow-job",
    });
    expect(persistDepositSlipOcrEvalSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: GROUP_ID,
        primaryJobId: "primary-job",
        shadowJobId: "shadow-job",
        boardKey: "board-1",
        hqEventId: "event-1",
        shadowTotalMs: 4200,
        rawLineCount: 100,
        uniqueLineCount: 61,
      }),
    );
  });

  it("skips snapshot persist when the comparisonJson claim loses a race", async () => {
    const { primaryRows, shadowRows } = queueHappyPath();
    mockState.selectQueue.push(primaryRows, shadowRows);
    mockState.claimReturns = [[]];

    await maybeCompareDepositSlipFingerprintShadow({ groupId: GROUP_ID });

    expect(mockState.updateSets).toHaveLength(1);
    expect(persistDepositSlipOcrEvalSnapshot).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no primary job on the group", async () => {
    mockState.selectQueue = [[]];

    await maybeCompareDepositSlipFingerprintShadow({ groupId: GROUP_ID });

    expect(persistDepositSlipOcrEvalSnapshot).not.toHaveBeenCalled();
    expect(mockState.updateSets).toHaveLength(0);
  });

  it("is a no-op when the primary has not been submitted yet (shadow finished first)", async () => {
    mockState.selectQueue = [
      [{ primaryJobId: "primary-job", boardKey: null, hqEventId: null, comparisonJson: null }],
      [{ parseSessionId: "primary-session" }],
      [{ status: "review" }],
    ];

    await maybeCompareDepositSlipFingerprintShadow({ groupId: GROUP_ID });

    expect(persistDepositSlipOcrEvalSnapshot).not.toHaveBeenCalled();
  });

  it("is a no-op when the shadow pass has not finished yet (primary submitted first)", async () => {
    mockState.selectQueue = [
      [{ primaryJobId: "primary-job", boardKey: null, hqEventId: null, comparisonJson: null }],
      [{ parseSessionId: "primary-session" }],
      [{ status: "submitted" }],
      [], // no shadow job row found for this group yet
    ];

    await maybeCompareDepositSlipFingerprintShadow({ groupId: GROUP_ID });

    expect(persistDepositSlipOcrEvalSnapshot).not.toHaveBeenCalled();
  });

  it("skips when a comparison already exists on the group (idempotency)", async () => {
    mockState.selectQueue = [
      [
        {
          primaryJobId: "primary-job",
          boardKey: null,
          hqEventId: null,
          comparisonJson: {
            deposit_slip_fingerprint_shadow: {
              kind: "deposit_slip_fingerprint_shadow",
              computedAt: "2026-07-14T00:00:00.000Z",
              primaryJobId: "primary-job",
              shadowJobId: "shadow-job",
              metrics: {},
              shadowTotalMs: null,
              rawLineCount: null,
              uniqueLineCount: null,
            },
          },
        },
      ],
    ];

    await maybeCompareDepositSlipFingerprintShadow({ groupId: GROUP_ID });

    expect(persistDepositSlipOcrEvalSnapshot).not.toHaveBeenCalled();
    expect(mockState.updateSets).toHaveLength(0);
  });
});
