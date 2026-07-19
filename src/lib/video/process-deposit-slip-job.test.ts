import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveHqAllianceIdFromSession = vi.fn();
const mockResolveDepositSlipMemberLinks = vi.fn();
const mockCreateDepositSlipMemberResolverCache = vi.fn();
const mockInsertValues = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSelectLimit = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("nanoid", () => ({
  nanoid: () => "generated-id",
}));

vi.mock("@/lib/members/resolve-hq-alliance", () => ({
  resolveHqAllianceIdFromSession: (sessionId: string) =>
    mockResolveHqAllianceIdFromSession(sessionId),
}));

vi.mock(
  "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server",
  () => ({
    resolveDepositSlipMemberLinks: (...args: unknown[]) =>
      mockResolveDepositSlipMemberLinks(...args),
    createDepositSlipMemberResolverCache: (...args: unknown[]) =>
      mockCreateDepositSlipMemberResolverCache(...args),
  }),
);

vi.mock("@/lib/video/ocr-deposit-slip-native", () => ({
  ocrDepositSlipNativeFrames: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (n: number) => mockSelectLimit(n),
          orderBy: () => mockSelectLimit("orderBy"),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (payload: unknown) => mockInsertValues(table, payload),
    }),
    update: (table: unknown) => ({
      set: (payload: unknown) => ({
        where: (condition: unknown) => mockUpdateWhere(table, payload, condition),
      }),
    }),
  }),
  schema: {
    parseSessions: {
      id: "parseSessions.id",
      allianceId: "parseSessions.allianceId",
      rowCount: "parseSessions.rowCount",
      matchedCount: "parseSessions.matchedCount",
    },
    parsedRows: { id: "parsedRows.id" },
    videoFrames: {
      jobId: "videoFrames.jobId",
      frameIndex: "videoFrames.frameIndex",
      ocrRawJson: "videoFrames.ocrRawJson",
    },
    videoJobs: {
      id: "videoJobs.id",
      parseSessionId: "videoJobs.parseSessionId",
      allianceId: "videoJobs.allianceId",
    },
  },
}));

import {
  finalizeDepositSlipVideoParse,
  processDepositSlipVideoParse,
} from "@/lib/video/process-deposit-slip-job";
import type { ParsedDepositSlipHistory } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";

const timer = {
  measureStep: async <T,>(
    _name: string,
    fn: () => T | Promise<T>,
  ): Promise<T> => fn(),
} as PipelineTimer;

describe("processDepositSlipVideoParse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveHqAllianceIdFromSession.mockResolvedValue("alliance-1");
    mockCreateDepositSlipMemberResolverCache.mockReturnValue({});
    mockResolveDepositSlipMemberLinks.mockResolvedValue({
      depositAllianceId: "alliance-1",
      allianceMemberId: "am-1",
      commanderId: "cmd-1",
      ashedMemberId: "ashed-1",
      matchMethod: "exact",
      matchConfidence: 1,
      candidateAshedMemberId: "ashed-1",
      candidateMemberName: "Alpha",
      candidateMatchMethod: "exact",
      candidateConfidence: 1,
      tagMatchMethod: "exact",
      tagMatchConfidence: 1,
    });
    mockInsertValues.mockResolvedValue(undefined);
    mockUpdateWhere.mockResolvedValue(undefined);
    // Single-shot mock path uses historyOverride — no load-from-frames select.
    mockSelectLimit.mockResolvedValue([]);
  });

  it("persists parsed rows with dedupe slip IDs so review actions match report members", async () => {
    const mockHistory = {
      depositPolicy: null,
      minimumDeposit: null,
      slips: [
        {
          slipId: "slip_keep",
          dedupeClusterId: "cluster-1",
          depositAt: "2026-07-11T10:00:00.000Z",
          termDays: 1,
          amount: 6000,
          status: "locked",
          outcomeAmount: null,
          outcomeKind: null,
          identity: {
            gameServerNumber: 1203,
            allianceTag: "LFgo",
            commanderName: "Alpha",
            rawIdentity: "#1203[LFgo]Alpha",
          },
          sourceFrameIndex: 0,
        },
        {
          slipId: "slip_delete",
          dedupeClusterId: "cluster-1",
          depositAt: "2026-07-11T10:00:00.000Z",
          termDays: 1,
          amount: 5000,
          status: "locked",
          outcomeAmount: null,
          outcomeKind: null,
          identity: {
            gameServerNumber: 1203,
            allianceTag: "LFgo",
            commanderName: "Alpha",
            rawIdentity: "#1203[LFgo]Alpha",
          },
          sourceFrameIndex: 1,
        },
      ],
    } as unknown as ParsedDepositSlipHistory;

    await processDepositSlipVideoParse({
      jobId: "job-1",
      sessionId: "session-1",
      scoreTargetId: "bank-deposit-slip-history",
      target: { id: "bank-deposit-slip-history" } as never,
      engine: "mock",
      frames: [
        { index: 0, buffer: Buffer.from("") },
        { index: 1, buffer: Buffer.from("") },
      ],
      timer,
      now: new Date("2026-07-12T00:00:00.000Z"),
      mockHistory,
    });

    const parsedRowsInsert = mockInsertValues.mock.calls.find(
      ([table]) =>
        typeof table === "object" &&
        table != null &&
        "id" in table &&
        table.id === "parsedRows.id",
    );
    expect(parsedRowsInsert?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "slip_keep",
          dedupeClusterId: "cluster-1",
          memberId: "ashed-1",
          memberName: "Alpha",
          matchConfidence: 1,
          matchMethod: "exact",
        }),
        expect.objectContaining({
          id: "slip_delete",
          dedupeClusterId: "cluster-1",
          memberId: "ashed-1",
        }),
      ]),
    );
    expect(mockResolveDepositSlipMemberLinks).toHaveBeenCalledTimes(2);
  });

  it("persists below-threshold fuzzy candidates for review without claiming auto-link FKs", async () => {
    mockResolveDepositSlipMemberLinks.mockResolvedValue({
      depositAllianceId: null,
      allianceMemberId: null,
      commanderId: null,
      ashedMemberId: null,
      matchMethod: "none",
      matchConfidence: 0,
      candidateAshedMemberId: "ashed-near",
      candidateMemberName: "Almost Alpha",
      candidateMatchMethod: "fuzzy",
      candidateConfidence: 0.72,
      tagMatchMethod: "none",
      tagMatchConfidence: 0,
    });

    const mockHistory = {
      depositPolicy: null,
      minimumDeposit: null,
      slips: [
        {
          slipId: "slip_near",
          dedupeClusterId: null,
          depositAt: "2026-07-11T10:00:00.000Z",
          termDays: 1,
          amount: 6000,
          status: "locked",
          outcomeAmount: null,
          outcomeKind: null,
          identity: {
            gameServerNumber: 1203,
            allianceTag: "LFgo",
            commanderName: "Alpa",
            rawIdentity: "#1203[LFgo]Alpa",
          },
          sourceFrameIndex: 0,
        },
      ],
    } as unknown as ParsedDepositSlipHistory;

    const result = await processDepositSlipVideoParse({
      jobId: "job-1",
      sessionId: "session-1",
      scoreTargetId: "bank-deposit-slip-history",
      target: { id: "bank-deposit-slip-history" } as never,
      engine: "mock",
      frames: [{ index: 0, buffer: Buffer.from("") }],
      timer,
      now: new Date("2026-07-12T00:00:00.000Z"),
      mockHistory,
    });

    expect(result.matchedCount).toBe(1);
    const parsedRowsInsert = mockInsertValues.mock.calls.find(
      ([table]) =>
        typeof table === "object" &&
        table != null &&
        "id" in table &&
        table.id === "parsedRows.id",
    );
    expect(parsedRowsInsert?.[1]).toEqual([
      expect.objectContaining({
        id: "slip_near",
        memberId: "ashed-near",
        memberName: "Almost Alpha",
        matchConfidence: 0.72,
        matchMethod: "none",
      }),
    ]);
  });
});

describe("finalizeDepositSlipVideoParse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveHqAllianceIdFromSession.mockResolvedValue("alliance-1");
    mockInsertValues.mockResolvedValue(undefined);
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  it("reuses an existing parse session on load-from-frames re-entry", async () => {
    mockSelectLimit
      .mockResolvedValueOnce([
        { parseSessionId: "parse-existing", allianceId: "alliance-1" },
      ])
      .mockResolvedValueOnce([
        {
          id: "parse-existing",
          allianceId: "alliance-1",
          rowCount: 7,
          matchedCount: 5,
        },
      ]);

    const result = await finalizeDepositSlipVideoParse({
      jobId: "job-1",
      sessionId: "session-1",
      scoreTargetId: "bank-deposit-slip-history",
      timer,
      now: new Date("2026-07-12T00:00:00.000Z"),
    });

    expect(result).toEqual({
      parseSessionId: "parse-existing",
      hqAllianceId: "alliance-1",
      rowCount: 7,
      matchedCount: 5,
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockResolveHqAllianceIdFromSession).not.toHaveBeenCalled();
  });
});
